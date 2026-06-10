(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function items(attributes) {
    return attributes.items && attributes.items.length ? attributes.items : [];
  }

  registerBlockType('wbdc/sky-rail', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const updateItem = function (index, key, value) {
        const next = items(attributes).slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ items: next });
      };
      return el('div', useBlockProps({ className: 'sky-rail', tabIndex: 0, 'aria-label': attributes.ariaLabel || undefined }),
        items(attributes).map(function (item, index) {
          return el('article', { key: index, className: item.hot ? 'hot' : undefined },
            el(RichText, { tagName: 'time', dateTime: item.datetime || undefined, value: item.time || '', allowedFormats: [], onChange: function (value) { updateItem(index, 'time', value); } }),
            el(RichText, { tagName: 'h3', value: item.title || '', allowedFormats: ['core/italic'], onChange: function (value) { updateItem(index, 'title', value); } }),
            el(RichText, { tagName: 'p', value: item.body || '', allowedFormats: ['core/bold', 'core/italic'], onChange: function (value) { updateItem(index, 'body', value); } })
          );
        })
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('div', useBlockProps.save({ className: 'sky-rail', tabIndex: 0, 'aria-label': attributes.ariaLabel || undefined }),
        items(attributes).map(function (item, index) {
          return el('article', { key: index, className: item.hot ? 'hot' : undefined },
            el(RichText.Content, { tagName: 'time', dateTime: item.datetime || undefined, value: item.time || '' }),
            el(RichText.Content, { tagName: 'h3', value: item.title || '' }),
            el(RichText.Content, { tagName: 'p', value: item.body || '' })
          );
        })
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
