(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function titleLines(attributes) {
    return attributes.titleLines && attributes.titleLines.length ? attributes.titleLines : [];
  }

  function metrics(attributes) {
    return attributes.metrics && attributes.metrics.length ? attributes.metrics : [];
  }

  function nodes(attributes) {
    return attributes.nodes && attributes.nodes.length ? attributes.nodes : [];
  }

  registerBlockType('wbdc/orbit-hero', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const updateTitleLine = function (index, value) {
        const next = titleLines(attributes).slice();
        next[index] = value;
        props.setAttributes({ titleLines: next });
      };
      const updateMetric = function (index, key, value) {
        const next = metrics(attributes).slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ metrics: next });
      };
      const updateNode = function (index, value) {
        const next = nodes(attributes).slice();
        next[index] = Object.assign({}, next[index], { label: value });
        props.setAttributes({ nodes: next });
      };
      return el('section', useBlockProps({ className: 'orbit-hero', 'aria-labelledby': attributes.titleId || undefined }),
        el('div', { className: 'hero-copy' },
          el(RichText, { tagName: 'p', className: 'micro', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el('h1', { id: attributes.titleId || undefined }, titleLines(attributes).map(function (line, index) {
            return el(RichText, { key: index, tagName: 'span', value: line || '', allowedFormats: [], onChange: function (value) { updateTitleLine(index, value); } });
          })),
          el(RichText, { tagName: 'p', className: 'thesis', value: attributes.thesis || '', allowedFormats: ['core/bold', 'core/italic'], onChange: function (value) { props.setAttributes({ thesis: value }); } })
        ),
        el('aside', { className: 'sensor-board', 'aria-label': attributes.boardAriaLabel || undefined },
          el(RichText, { tagName: 'p', value: attributes.boardLabel || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ boardLabel: value }); } }),
          el(RichText, { tagName: 'strong', value: attributes.boardStatus || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ boardStatus: value }); } }),
          el('dl', null, metrics(attributes).map(function (metric, index) {
            return el('div', { key: index },
              el(RichText, { tagName: 'dt', value: metric.label || '', allowedFormats: [], onChange: function (value) { updateMetric(index, 'label', value); } }),
              el(RichText, { tagName: 'dd', value: metric.value || '', allowedFormats: [], onChange: function (value) { updateMetric(index, 'value', value); } })
            );
          }))
        ),
        el('div', { className: 'orbit-visual', 'aria-label': attributes.visualAriaLabel || undefined },
          el('span', { className: 'ring ring-one' }),
          el('span', { className: 'ring ring-two' }),
          el('span', { className: 'axis axis-x' }),
          el('span', { className: 'axis axis-y' }),
          nodes(attributes).map(function (node, index) {
            return el(RichText, { key: index, tagName: 'span', className: 'market-node ' + (node.className || ''), value: node.label || '', allowedFormats: [], onChange: function (value) { updateNode(index, value); } });
          })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ className: 'orbit-hero', 'aria-labelledby': attributes.titleId || undefined }),
        el('div', { className: 'hero-copy' },
          el(RichText.Content, { tagName: 'p', className: 'micro', value: attributes.eyebrow || '' }),
          el('h1', { id: attributes.titleId || undefined }, titleLines(attributes).map(function (line, index) {
            return el(RichText.Content, { key: index, tagName: 'span', value: line || '' });
          })),
          el(RichText.Content, { tagName: 'p', className: 'thesis', value: attributes.thesis || '' })
        ),
        el('aside', { className: 'sensor-board', 'aria-label': attributes.boardAriaLabel || undefined },
          el(RichText.Content, { tagName: 'p', value: attributes.boardLabel || '' }),
          el(RichText.Content, { tagName: 'strong', value: attributes.boardStatus || '' }),
          el('dl', null, metrics(attributes).map(function (metric, index) {
            return el('div', { key: index },
              el(RichText.Content, { tagName: 'dt', value: metric.label || '' }),
              el(RichText.Content, { tagName: 'dd', value: metric.value || '' })
            );
          }))
        ),
        el('div', { className: 'orbit-visual', 'aria-label': attributes.visualAriaLabel || undefined },
          el('span', { className: 'ring ring-one' }),
          el('span', { className: 'ring ring-two' }),
          el('span', { className: 'axis axis-x' }),
          el('span', { className: 'axis axis-y' }),
          nodes(attributes).map(function (node, index) {
            return el(RichText.Content, { key: index, tagName: 'span', className: 'market-node ' + (node.className || ''), value: node.label || '' });
          })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
