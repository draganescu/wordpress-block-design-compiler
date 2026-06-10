(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function classes(attributes) {
    return ['object-card', attributes.layoutVariant || ''].filter(Boolean).join(' ');
  }

  function photoClass(attributes) {
    return ['object-photo', 'photo-' + (attributes.photoVariant || 'vase')].join(' ');
  }

  registerBlockType('wbdc/maison-object-card', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('article', useBlockProps({ className: classes(attributes) }),
        el('div', { className: photoClass(attributes), role: 'img', 'aria-label': attributes.title || '' }),
        el('div', { className: 'object-meta' },
          el(RichText, { tagName: 'span', value: attributes.category || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ category: value }); } }),
          el(RichText, { tagName: 'strong', value: attributes.price || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ price: value }); } })
        ),
        el(RichText, { tagName: 'h3', value: attributes.title || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ title: value }); } }),
        el('details', null,
          el('summary', null,
            el(RichText, { tagName: 'span', value: attributes.buttonText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ buttonText: value }); } })
          ),
          el(RichText, { tagName: 'p', value: attributes.story || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ story: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('article', useBlockProps.save({ className: classes(attributes) }),
        el('div', { className: photoClass(attributes), role: 'img', 'aria-label': attributes.title || '' }),
        el('div', { className: 'object-meta' },
          el(RichText.Content, { tagName: 'span', value: attributes.category || '' }),
          el(RichText.Content, { tagName: 'strong', value: attributes.price || '' })
        ),
        el(RichText.Content, { tagName: 'h3', value: attributes.title || '' }),
        el('details', null,
          el('summary', null, el(RichText.Content, { tagName: 'span', value: attributes.buttonText || '' })),
          el(RichText.Content, { tagName: 'p', value: attributes.story || '' })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
