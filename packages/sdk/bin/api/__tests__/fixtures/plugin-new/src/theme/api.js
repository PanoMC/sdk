import ApiUtil from '@panomc/sdk/utils/api';

export async function load(event, id, body) {
  const things = await ApiUtil.get({ path: '/plugins/pano-plugin-demo/things', request: event });
  if (!things.error) {
    console.log(things.items);
  }
  if (things.error?.code === 'NOT_FOUND_THING') {
    return null;
  }

  // not an API value: must stay as it is
  const other = { error: 'X', result: 'ok', errors: {} };
  if (other.error === 'X') {
    console.log(other.errors, other.result);
  }

  const saved = await ApiUtil.post({ path: `/plugins/pano-plugin-demo/things/${id}`, body });
  if (!!saved.error) {
    return saved.error?.fields;
  }

  ApiUtil.get({ path: '/site-info' }).then((res) => {
    if (res.error?.code !== 'A') return !!res.error;
  });

  const hook = await ApiUtil.get({ path: `/plugins/pano-plugin-demo/payments/${id}/return/done?x=1` });
  return !hook.error;
}
