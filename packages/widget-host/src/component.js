// `@panomc/sdk/utils/component` in a widget: `viewComponent` is the identity (doc 06 section 3.2), the wrapper mounts the component itself.
export function viewComponent(importer) {
  return importer;
}
