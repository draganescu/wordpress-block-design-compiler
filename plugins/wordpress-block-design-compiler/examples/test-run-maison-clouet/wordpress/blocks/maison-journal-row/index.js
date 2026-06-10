(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function posts(attributes) {
    return attributes.posts && attributes.posts.length ? attributes.posts : [];
  }

  function updatePost(attributes, setAttributes, index, key, value) {
    const next = posts(attributes).slice();
    next[index] = Object.assign({}, next[index], { [key]: value });
    setAttributes({ posts: next });
  }

  registerBlockType('wbdc/maison-journal-row', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps({ id: attributes.sectionId || undefined, className: 'maison-journal', 'aria-labelledby': 'maison-journal-title' }),
        el('div', { className: 'maison-section-head' },
          el(RichText, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el(RichText, { tagName: 'h2', id: 'maison-journal-title', value: attributes.heading || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ heading: value }); } })
        ),
        el('div', { className: 'maison-journal-row' },
          posts(attributes).map(function (post, index) {
            return el('article', { key: index },
              el(RichText, { tagName: 'span', value: post.label || '', allowedFormats: [], onChange: function (value) { updatePost(attributes, props.setAttributes, index, 'label', value); } }),
              el(RichText, { tagName: 'h3', value: post.title || '', allowedFormats: ['core/italic'], onChange: function (value) { updatePost(attributes, props.setAttributes, index, 'title', value); } })
            );
          })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ id: attributes.sectionId || undefined, className: 'maison-journal', 'aria-labelledby': 'maison-journal-title' }),
        el('div', { className: 'maison-section-head' },
          el(RichText.Content, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '' }),
          el(RichText.Content, { tagName: 'h2', id: 'maison-journal-title', value: attributes.heading || '' })
        ),
        el('div', { className: 'maison-journal-row' },
          posts(attributes).map(function (post, index) {
            return el('article', { key: index },
              el(RichText.Content, { tagName: 'span', value: post.label || '' }),
              el(RichText.Content, { tagName: 'h3', value: post.title || '' })
            );
          })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
