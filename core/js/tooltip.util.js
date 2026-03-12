import tippy from 'tippy.js';
import { page } from '$app/stores';

function setTooltip(element, [value, options]) {
  const instance = typeof element._tippy === 'undefined' ? tippy(element) : element._tippy;

  instance.setContent(value);
  instance.setProps(options);
}

export default function tooltip(element, properties) {
  if (!properties) {
    return;
  }

  let [value, options] = properties;

  let unsubscribePage;

  if (value) {
    if (typeof options === 'undefined') options = {};
    if (typeof options.placement === 'undefined') options.placement = 'bottom';

    setTooltip(element, [value, options]);

    unsubscribePage = page.subscribe(() => {
      const instance = typeof element._tippy === 'undefined' ? tippy(element) : element._tippy;

      instance.hide();
    });
  }

  return {
    update(updatedValue) {
      if (!updatedValue) {
        return;
      }

      let [value, options] = updatedValue;

      if (!value) {
        const instance = typeof element._tippy === 'undefined' ? tippy(element) : element._tippy;

        instance.destroy();

        return;
      }

      if (typeof options === 'undefined') options = {};
      if (typeof options.placement === 'undefined') options.placement = 'bottom';

      setTooltip(element, [value, options]);
    },

    onDestroy() {
      const instance = typeof element._tippy === 'undefined' ? tippy(element) : element._tippy;

      instance.destroy();
      if (unsubscribePage) {
        unsubscribePage();
      }
    },
  };
}
