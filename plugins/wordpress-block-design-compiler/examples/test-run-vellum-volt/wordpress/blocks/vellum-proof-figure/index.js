(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function dots(count) {
    return Array.from({ length: Math.max(1, Number(count) || 3) });
  }

  registerBlockType('wbdc/vellum-proof-figure', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('figure', useBlockProps({ className: 'press-proof', 'aria-label': attributes.ariaLabel || undefined }),
        el('div', { className: 'proof-card proof-card-main' },
          el(RichText, { tagName: 'span', className: 'proof-kicker', value: attributes.kicker || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ kicker: value }); } }),
          el(RichText, { tagName: 'strong', value: attributes.title || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ title: value }); } }),
          el(RichText, { tagName: 'span', value: attributes.detail || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ detail: value }); } })
        ),
        el('div', { className: 'proof-card proof-card-side', 'aria-hidden': true },
          dots(attributes.dotCount).map(function (_, index) {
            return el('span', { key: index, className: 'proof-dot' });
          })
        ),
        el('div', { className: 'registration-grid', 'aria-hidden': true })
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('figure', useBlockProps.save({ className: 'press-proof', 'aria-label': attributes.ariaLabel || undefined }),
        el('div', { className: 'proof-card proof-card-main' },
          el(RichText.Content, { tagName: 'span', className: 'proof-kicker', value: attributes.kicker || '' }),
          el(RichText.Content, { tagName: 'strong', value: attributes.title || '' }),
          el(RichText.Content, { tagName: 'span', value: attributes.detail || '' })
        ),
        el('div', { className: 'proof-card proof-card-side', 'aria-hidden': true },
          dots(attributes.dotCount).map(function (_, index) {
            return el('span', { key: index, className: 'proof-dot' });
          })
        ),
        el('div', { className: 'registration-grid', 'aria-hidden': true })
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
