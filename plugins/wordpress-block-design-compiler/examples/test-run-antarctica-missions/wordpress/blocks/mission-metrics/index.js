(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;

  function items(attrs) {
    return attrs.items && attrs.items.length ? attrs.items : [
      { label: 'Temp', value: '-48°C' },
      { label: 'Wind', value: '61 knots' },
      { label: 'Payload', value: '12 cores' }
    ];
  }

  registerBlockType('wbdc/mission-metrics', {
    edit: function Edit(props) {
      return el('dl', useBlockProps({ className: 'mission-metrics' }), items(props.attributes).map(function (item, index) {
        return el('div', { key: index }, el('dt', null, item.label), el('dd', null, item.value));
      }));
    },
    save: function Save(props) {
      return el('dl', useBlockProps.save({ className: 'mission-metrics' }), items(props.attributes).map(function (item, index) {
        return el('div', { key: index }, el('dt', null, item.label), el('dd', null, item.value));
      }));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
