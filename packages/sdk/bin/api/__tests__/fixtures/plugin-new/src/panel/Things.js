import ApiUtil from '@panomc/sdk/utils/api';

export const addons = () => ApiUtil.get({ path: '/panel/addons' });
export const thing = (id) => ApiUtil.get({ path: `/plugins/pano-plugin-demo/panel/things/${id}` });
