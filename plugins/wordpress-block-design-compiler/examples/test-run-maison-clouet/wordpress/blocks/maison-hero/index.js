(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function flatlay(attributes, editable, setAttributes) {
    const tag = editable
      ? el(RichText, { tagName: 'span', className: 'paper-tag', value: attributes.tag || '', allowedFormats: [], onChange: function (value) { setAttributes({ tag: value }); } })
      : el(RichText.Content, { tagName: 'span', className: 'paper-tag', value: attributes.tag || '' });
    const caption = editable
      ? el(RichText, { tagName: 'figcaption', value: attributes.caption || '', allowedFormats: ['core/italic'], onChange: function (value) { setAttributes({ caption: value }); } })
      : el(RichText.Content, { tagName: 'figcaption', value: attributes.caption || '' });

    return el('figure', { className: 'maison-flatlay', 'aria-label': 'Flatlay of current Maison Clouet finds' },
      tag,
      el('i', { className: 'maison-flatlay-object plate', 'aria-hidden': 'true' }),
      el('i', { className: 'maison-flatlay-object lamp', 'aria-hidden': 'true' }),
      el('i', { className: 'maison-flatlay-object linen', 'aria-hidden': 'true' }),
      el('i', { className: 'maison-flatlay-object vase', 'aria-hidden': 'true' }),
      caption
    );
  }

  registerBlockType('wbdc/maison-hero', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps({ className: 'maison-hero', 'aria-labelledby': 'maison-hero-title' }),
        el('div', { className: 'maison-hero-copy' },
          el(RichText, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el(RichText, { tagName: 'h1', id: 'maison-hero-title', value: attributes.title || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ title: value }); } }),
          el(RichText, { tagName: 'p', className: 'maison-intro', value: attributes.intro || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ intro: value }); } })
        ),
        flatlay(attributes, true, props.setAttributes)
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ className: 'maison-hero', 'aria-labelledby': 'maison-hero-title' }),
        el('div', { className: 'maison-hero-copy' },
          el(RichText.Content, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '' }),
          el(RichText.Content, { tagName: 'h1', id: 'maison-hero-title', value: attributes.title || '' }),
          el(RichText.Content, { tagName: 'p', className: 'maison-intro', value: attributes.intro || '' })
        ),
        flatlay(attributes, false)
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
