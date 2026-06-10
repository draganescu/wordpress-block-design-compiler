(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/market-footer', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('footer', useBlockProps({ className: 'market-footer' }),
        el(RichText, { tagName: 'p', value: attributes.text || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ text: value }); } }),
        el('a', { href: attributes.url || '#top' },
          el(RichText, { tagName: 'span', value: attributes.linkText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ linkText: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('footer', useBlockProps.save({ className: 'market-footer' }),
        el(RichText.Content, { tagName: 'p', value: attributes.text || '' }),
        el('a', { href: attributes.url || '#top' },
          el(RichText.Content, { tagName: 'span', value: attributes.linkText || '' })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
