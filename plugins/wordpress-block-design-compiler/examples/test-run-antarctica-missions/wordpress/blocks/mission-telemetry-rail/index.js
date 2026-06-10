(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  const defaults = [
    { index: '01', title: 'Dome C atmospheric drill', body: 'Balloon launches through diamond dust, collecting upper-air chemistry before the horizon disappears.', className: 'wide-card' },
    { index: '02', title: 'Ross Ice Shelf traverse', body: 'Ground radar marks hidden fracture fields under a convoy moving slower than walking pace.', className: '' },
    { index: '03', title: 'Vostok core relay', body: 'Two meters of ancient air are sealed and flown before thermal variance corrupts the sample.', className: 'accent-card' },
    { index: '04', title: 'Weddell acoustic night', body: 'Hydrophones listen under blue ice while the camp runs blackout discipline.', className: 'tall-card' }
  ];

  function getItems(items) {
    return items && items.length ? items : defaults;
  }

  function renderItems(items, editable, setAttributes) {
    const current = getItems(items);
    const updateItem = function (index, key, value) {
      const next = current.slice();
      next[index] = Object.assign({}, next[index], { [key]: value });
      setAttributes({ items: next });
    };

    return current.map(function (item, index) {
      const className = ['mission-card', item.className || ''].join(' ').trim();
      return el('article', { className: className, key: index },
        editable
          ? el(RichText, {
              tagName: 'span',
              value: item.index || '',
              allowedFormats: [],
              onChange: function (value) { updateItem(index, 'index', value); }
            })
          : el('span', null, item.index || ''),
        editable
          ? el(RichText, {
              tagName: 'h3',
              value: item.title || '',
              allowedFormats: ['core/bold', 'core/italic'],
              onChange: function (value) { updateItem(index, 'title', value); }
            })
          : el('h3', null, item.title || ''),
        editable
          ? el(RichText, {
              tagName: 'p',
              value: item.body || '',
              allowedFormats: ['core/bold', 'core/italic', 'core/link'],
              onChange: function (value) { updateItem(index, 'body', value); }
            })
          : el('p', null, item.body || '')
      );
    });
  }

  registerBlockType('wbdc/mission-telemetry-rail', {
    edit: function Edit(props) {
      const blockProps = useBlockProps({ className: 'telemetry-rail' });
      return el('div', Object.assign({}, blockProps, { tabIndex: 0, 'aria-label': 'Mission timeline' }), renderItems(props.attributes.items, true, props.setAttributes));
    },

    save: function Save(props) {
      const blockProps = useBlockProps.save({ className: 'telemetry-rail' });
      return el('div', Object.assign({}, blockProps, { tabIndex: 0, 'aria-label': 'Mission timeline' }), renderItems(props.attributes.items, false, function () {}));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
