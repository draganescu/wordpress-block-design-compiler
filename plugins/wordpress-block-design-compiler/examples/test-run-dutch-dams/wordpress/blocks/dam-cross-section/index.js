(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/dam-cross-section', {
    edit: function Edit(props) {
      const layers = props.attributes.layers || [];
      const updateLayer = function (index, value) {
        const next = layers.slice();
        next[index] = Object.assign({}, next[index], { label: value });
        props.setAttributes({ layers: next });
      };
      return el('figure', useBlockProps({ className: 'dam-cross-section', 'aria-label': props.attributes.ariaLabel || undefined }),
        layers.map(function (layer, index) {
          return el('div', { key: index, className: ['slice', layer.className || ''].filter(Boolean).join(' ') },
            el(RichText, { tagName: 'span', value: layer.label || '', allowedFormats: [], onChange: function (value) { updateLayer(index, value); } })
          );
        }),
        el(RichText, { tagName: 'figcaption', value: props.attributes.caption || '', allowedFormats: ['core/bold', 'core/italic', 'core/link'], onChange: function (value) { props.setAttributes({ caption: value }); } })
      );
    },
    save: function Save(props) {
      return el('figure', useBlockProps.save({ className: 'dam-cross-section', 'aria-label': props.attributes.ariaLabel || undefined }),
        (props.attributes.layers || []).map(function (layer, index) {
          return el('div', { key: index, className: ['slice', layer.className || ''].filter(Boolean).join(' ') },
            el(RichText.Content, { tagName: 'span', value: layer.label || '' })
          );
        }),
        el(RichText.Content, { tagName: 'figcaption', value: props.attributes.caption || '' })
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
