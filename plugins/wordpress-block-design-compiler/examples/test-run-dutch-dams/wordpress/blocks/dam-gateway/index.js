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

  registerBlockType('wbdc/dam-gateway', {
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
      return el('section', useBlockProps({ className: 'gateway', 'aria-labelledby': attributes.titleId || undefined }),
        el('div', { className: 'gateway-type' },
          el(RichText, { tagName: 'p', className: 'micro', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el('h1', { id: attributes.titleId || undefined },
            titleLines(attributes).map(function (line, index) {
              return el(RichText, { key: index, tagName: 'span', value: line || '', allowedFormats: [], onChange: function (value) { updateTitleLine(index, value); } });
            })
          ),
          el(RichText, { tagName: 'p', className: 'thesis', value: attributes.thesis || '', allowedFormats: ['core/bold', 'core/italic'], onChange: function (value) { props.setAttributes({ thesis: value }); } })
        ),
        el('aside', { className: 'gateway-panel', 'aria-label': attributes.panelAriaLabel || undefined },
          el(RichText, { tagName: 'p', value: attributes.panelLabel || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ panelLabel: value }); } }),
          el(RichText, { tagName: 'strong', value: attributes.panelStatus || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ panelStatus: value }); } }),
          el('dl', null, metrics(attributes).map(function (metric, index) {
            return el('div', { key: index },
              el(RichText, { tagName: 'dt', value: metric.label || '', allowedFormats: [], onChange: function (value) { updateMetric(index, 'label', value); } }),
              el(RichText, { tagName: 'dd', value: metric.value || '', allowedFormats: [], onChange: function (value) { updateMetric(index, 'value', value); } })
            );
          }))
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ className: 'gateway', 'aria-labelledby': attributes.titleId || undefined }),
        el('div', { className: 'gateway-type' },
          el(RichText.Content, { tagName: 'p', className: 'micro', value: attributes.eyebrow || '' }),
          el('h1', { id: attributes.titleId || undefined },
            titleLines(attributes).map(function (line, index) {
              return el(RichText.Content, { key: index, tagName: 'span', value: line || '' });
            })
          ),
          el(RichText.Content, { tagName: 'p', className: 'thesis', value: attributes.thesis || '' })
        ),
        el('aside', { className: 'gateway-panel', 'aria-label': attributes.panelAriaLabel || undefined },
          el(RichText.Content, { tagName: 'p', value: attributes.panelLabel || '' }),
          el(RichText.Content, { tagName: 'strong', value: attributes.panelStatus || '' }),
          el('dl', null, metrics(attributes).map(function (metric, index) {
            return el('div', { key: index },
              el(RichText.Content, { tagName: 'dt', value: metric.label || '' }),
              el(RichText.Content, { tagName: 'dd', value: metric.value || '' })
            );
          }))
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
