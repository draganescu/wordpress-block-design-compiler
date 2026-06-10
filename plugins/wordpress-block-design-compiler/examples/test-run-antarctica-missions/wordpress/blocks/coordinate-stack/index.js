(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;

  function items(attrs) {
    return attrs.items && attrs.items.length ? attrs.items : [];
  }

  registerBlockType('wbdc/coordinate-stack', {
    edit: function Edit(props) {
      return el('div', useBlockProps({ className: 'coordinate-stack' }), items(props.attributes).map(function (item, index) {
        return el('p', { key: index }, el('span', null, item.label), ' ', item.value);
      }));
    },
    save: function Save(props) {
      return el('div', useBlockProps.save({ className: 'coordinate-stack' }), items(props.attributes).map(function (item, index) {
        return el('p', { key: index }, el('span', null, item.label), ' ', item.value);
      }));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
