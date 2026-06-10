(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function stalls(attributes) {
    return attributes.stalls && attributes.stalls.length ? attributes.stalls : [];
  }

  registerBlockType('wbdc/stall-constellation', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const updateStall = function (index, key, value) {
        const next = stalls(attributes).slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ stalls: next });
      };
      return el('div', useBlockProps({ className: 'stall-constellation', 'aria-label': attributes.ariaLabel || undefined }),
        stalls(attributes).map(function (stall, index) {
          return el('article', { key: index, className: 'stall-card ' + (stall.variant || '') },
            el(RichText, { tagName: 'span', value: stall.kicker || '', allowedFormats: [], onChange: function (value) { updateStall(index, 'kicker', value); } }),
            el(RichText, { tagName: 'h3', value: stall.title || '', allowedFormats: ['core/italic'], onChange: function (value) { updateStall(index, 'title', value); } }),
            el(RichText, { tagName: 'p', value: stall.body || '', allowedFormats: ['core/bold', 'core/italic'], onChange: function (value) { updateStall(index, 'body', value); } }),
            el(RichText, { tagName: 'strong', value: stall.meta || '', allowedFormats: [], onChange: function (value) { updateStall(index, 'meta', value); } })
          );
        })
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('div', useBlockProps.save({ className: 'stall-constellation', 'aria-label': attributes.ariaLabel || undefined }),
        stalls(attributes).map(function (stall, index) {
          return el('article', { key: index, className: 'stall-card ' + (stall.variant || '') },
            el(RichText.Content, { tagName: 'span', value: stall.kicker || '' }),
            el(RichText.Content, { tagName: 'h3', value: stall.title || '' }),
            el(RichText.Content, { tagName: 'p', value: stall.body || '' }),
            el(RichText.Content, { tagName: 'strong', value: stall.meta || '' })
          );
        })
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
