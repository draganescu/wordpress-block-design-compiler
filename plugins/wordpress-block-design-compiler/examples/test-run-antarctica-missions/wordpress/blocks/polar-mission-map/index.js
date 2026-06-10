(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function defaultNodes(nodes) {
    return nodes && nodes.length ? nodes : [
      { label: 'VOSTOK', className: 'node-one' },
      { label: 'ROSS', className: 'node-two' },
      { label: 'DOME C', className: 'node-three' }
    ];
  }

  function mapMarkup(attributes, editable, setAttributes) {
    const nodes = defaultNodes(attributes.nodes);
    const updateNode = function (index, value) {
      const next = nodes.slice();
      next[index] = Object.assign({}, next[index], { label: value });
      setAttributes({ nodes: next });
    };

    return [
      el('div', { className: 'map-grid', 'aria-hidden': true },
        el('span', { className: 'orbit orbit-a' }),
        el('span', { className: 'orbit orbit-b' }),
        el('span', { className: 'axis axis-x' }),
        el('span', { className: 'axis axis-y' }),
        nodes.map(function (node, index) {
          return editable
            ? el(RichText, {
                key: index,
                tagName: 'span',
                className: 'node ' + (node.className || ''),
                value: node.label || '',
                allowedFormats: [],
                onChange: function (value) { updateNode(index, value); }
              })
            : el('span', { key: index, className: 'node ' + (node.className || '') }, node.label || '');
        })
      ),
      el('figcaption', null,
        editable
          ? el(RichText, {
              tagName: 'strong',
              value: attributes.title || '',
              allowedFormats: ['core/bold', 'core/italic'],
              onChange: function (value) { setAttributes({ title: value }); }
            })
          : el('strong', null, attributes.title || ''),
        editable
          ? el(RichText, {
              tagName: 'span',
              value: attributes.caption || '',
              allowedFormats: ['core/bold', 'core/italic'],
              onChange: function (value) { setAttributes({ caption: value }); }
            })
          : el('span', null, attributes.caption || '')
      )
    ];
  }

  registerBlockType('wbdc/polar-mission-map', {
    edit: function Edit(props) {
      const blockProps = useBlockProps({ className: 'polar-plate' });
      return el('figure', blockProps, mapMarkup(props.attributes, true, props.setAttributes));
    },

    save: function Save(props) {
      const blockProps = useBlockProps.save({ className: 'polar-plate' });
      return el('figure', blockProps, mapMarkup(props.attributes, false, function () {}));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
