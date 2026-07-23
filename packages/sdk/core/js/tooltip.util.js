import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { page } from '$app/stores';

function setTooltip(element, [value, options]) {
  const instance = typeof element._tippy === 'undefined' ? tippy(element) : element._tippy;

  instance.setContent(value);
  instance.setProps(options);
}

export default function tooltip(element, properties) {
  let unsubscribePage;
  let instance;

  const init = (props) => {
    if (!props) return;
    
    let [value, options] = props;
    if (!value) {
       if (instance) instance.destroy();
       instance = null;
       return;
    }

    if (!instance) {
      instance = tippy(element);
    }

    const mergedOptions = {
      content: value,
      placement: 'bottom',
      interactive: true,
      animation: 'fade',
      ...options
    };

    instance.setProps(mergedOptions);

    if (!unsubscribePage) {
      unsubscribePage = page.subscribe(() => {
        if (instance) instance.hide();
      });
    }
  };

  init(properties);

  return {
    update(updatedProperties) {
      init(updatedProperties);
    },

    destroy() {
      if (instance) instance.destroy();
      if (unsubscribePage) unsubscribePage();
    },
  };
}
