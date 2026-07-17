import ApiUtil from "$pano/lib/api.util";

export const saveThemeSettings = async (settings) => {
  const body = new FormData();

  if (settings.uploads) {
    Object.keys(settings.uploads).forEach(key => {
      body.append(key, settings.uploads[key]);
    });

    delete settings["uploads"];
  }


  body.append("settings", JSON.stringify(settings));

  return ApiUtil.put({
    path: `/api/panel/theme/settings`,
    body,
    blob: true
  });
};