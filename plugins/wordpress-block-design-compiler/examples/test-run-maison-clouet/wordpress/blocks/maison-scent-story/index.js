(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/maison-scent-story', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps({ id: attributes.sectionId || undefined, className: 'maison-scent', 'aria-labelledby': 'maison-scent-title' }),
        el(RichText, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
        el(RichText, { tagName: 'h2', id: 'maison-scent-title', value: attributes.heading || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ heading: value }); } }),
        el(RichText, { tagName: 'p', className: 'maison-scent-body', value: attributes.body || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ body: value }); } })
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ id: attributes.sectionId || undefined, className: 'maison-scent', 'aria-labelledby': 'maison-scent-title' }),
        el(RichText.Content, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '' }),
        el(RichText.Content, { tagName: 'h2', id: 'maison-scent-title', value: attributes.heading || '' }),
        el(RichText.Content, { tagName: 'p', className: 'maison-scent-body', value: attributes.body || '' })
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
