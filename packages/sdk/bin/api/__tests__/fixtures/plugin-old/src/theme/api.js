import ApiUtil from '@panomc/sdk/utils/api';

export async function load(event, id, body) {
  const things = await ApiUtil.get({ path: '/api/demo/things', request: event });
  if (things.result === 'ok') {
    console.log(things.items);
  }
  if (things.error === 'NOT_FOUND_THING') {
    return null;
  }

  // not an API value: must stay as it is
  const other = { error: 'X', result: 'ok', errors: {} };
  if (other.error === 'X') {
    console.log(other.errors, other.result);
  }

  const saved = await ApiUtil.post({ path: `/api/demo/things/${id}`, body });
  if (saved.result === 'error') {
    return saved.errors;
  }

  ApiUtil.get({ path: '/api/siteInfo' }).then((res) => {
    if (res.error !== 'A') return res.result !== 'ok';
  });

  const hook = await ApiUtil.get({ path: `/api/demo/payments/${id}/return/done?x=1` });
  return hook.result == 'ok';
}
