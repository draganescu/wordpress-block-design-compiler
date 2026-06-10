(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/maison-footer', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('footer', useBlockProps({ className: 'maison-footer' }),
        el(RichText, { tagName: 'p', value: attributes.left || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ left: value }); } }),
        el(RichText, { tagName: 'p', value: attributes.middle || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ middle: value }); } }),
        el('a', { href: attributes.backUrl || '#top' },
          el(RichText, { tagName: 'span', value: attributes.backText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ backText: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('footer', useBlockProps.save({ className: 'maison-footer' }),
        el(RichText.Content, { tagName: 'p', value: attributes.left || '' }),
        el(RichText.Content, { tagName: 'p', value: attributes.middle || '' }),
        el('a', { href: attributes.backUrl || '#top' },
          el(RichText.Content, { tagName: 'span', value: attributes.backText || '' })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
