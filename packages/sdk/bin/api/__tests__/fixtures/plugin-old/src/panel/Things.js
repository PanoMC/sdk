import ApiUtil from '@panomc/sdk/utils/api';

export const addons = () => ApiUtil.get({ path: '/api/panel/plugins' });
export const thing = (id) => ApiUtil.get({ path: `/api/panel/demo/things/${id}` });
