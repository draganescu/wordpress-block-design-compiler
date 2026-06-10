(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/archive-reveal-band', {
    edit: function Edit(props) {
      const plates = props.attributes.plates || [];
      const updatePlate = function (index, key, value) {
        const next = plates.slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ plates: next });
      };
      return el('section', useBlockProps({ className: 'archive-reveal-band', 'aria-label': props.attributes.ariaLabel || undefined }),
        plates.map(function (plate, index) {
          return el('article', { key: index, className: ['archive-plate', plate.className || ''].filter(Boolean).join(' ') },
            el(RichText, { tagName: 'span', value: plate.label || '', allowedFormats: [], onChange: function (value) { updatePlate(index, 'label', value); } }),
            el(RichText, { tagName: 'h3', value: plate.title || '', allowedFormats: ['core/italic'], onChange: function (value) { updatePlate(index, 'title', value); } }),
            el(RichText, { tagName: 'p', value: plate.body || '', allowedFormats: ['core/bold', 'core/italic', 'core/link'], onChange: function (value) { updatePlate(index, 'body', value); } })
          );
        })
      );
    },
    save: function Save(props) {
      return el('section', useBlockProps.save({ className: 'archive-reveal-band', 'aria-label': props.attributes.ariaLabel || undefined }), (props.attributes.plates || []).map(function (plate, index) {
        return el('article', { key: index, className: ['archive-plate', plate.className || ''].filter(Boolean).join(' ') },
          el(RichText.Content, { tagName: 'span', value: plate.label || '' }),
          el(RichText.Content, { tagName: 'h3', value: plate.title || '' }),
          el(RichText.Content, { tagName: 'p', value: plate.body || '' })
        );
      }));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
