(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function items(attributes) {
    return attributes.objects && attributes.objects.length ? attributes.objects : [];
  }

  function filters(attributes) {
    return attributes.filters && attributes.filters.length ? attributes.filters : [];
  }

  function updateObject(attributes, setAttributes, index, key, value) {
    const next = items(attributes).slice();
    next[index] = Object.assign({}, next[index], { [key]: value });
    setAttributes({ objects: next });
  }

  function objectCard(item, index, editable, attributes, setAttributes) {
    const variant = item.layoutVariant || '';
    const className = ['maison-object-card', variant].filter(Boolean).join(' ');
    const photoClass = ['maison-object-photo', 'photo-' + (item.photoVariant || 'vase')].join(' ');
    const text = function (tagName, key, classNameValue) {
      return editable
        ? el(RichText, { tagName: tagName, className: classNameValue, value: item[key] || '', allowedFormats: ['core/italic'], onChange: function (value) { updateObject(attributes, setAttributes, index, key, value); } })
        : el(RichText.Content, { tagName: tagName, className: classNameValue, value: item[key] || '' });
    };

    return el('article', { key: index, className: className },
      el('div', { className: photoClass, role: 'img', 'aria-label': item.title || '' }),
      el('div', { className: 'maison-object-meta' },
        text('span', 'category'),
        text('span', 'price')
      ),
      text('h3', 'title'),
      el('details', null,
        el('summary', null, text('span', 'buttonText')),
        text('p', 'story'),
        el('dl', null,
          el('div', null, el('dt', null, 'Dimensions'), el('dd', null, item.dimensions || '')),
          el('div', null, el('dt', null, 'Condition'), el('dd', null, item.condition || ''))
        )
      )
    );
  }

  registerBlockType('wbdc/maison-arrivals', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps({ id: attributes.sectionId || undefined, className: 'maison-arrivals', 'aria-labelledby': 'maison-arrivals-title' }),
        el('div', { className: 'maison-section-head' },
          el(RichText, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el(RichText, { tagName: 'h2', id: 'maison-arrivals-title', value: attributes.heading || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ heading: value }); } })
        ),
        el('div', { className: 'maison-filter-row', 'aria-label': 'Objet categories' },
          filters(attributes).map(function (filter, index) {
            return el('button', { key: index, type: 'button' }, filter);
          })
        ),
        el('div', { className: 'maison-object-grid' },
          items(attributes).map(function (item, index) {
            return objectCard(item, index, true, attributes, props.setAttributes);
          })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ id: attributes.sectionId || undefined, className: 'maison-arrivals', 'aria-labelledby': 'maison-arrivals-title' }),
        el('div', { className: 'maison-section-head' },
          el(RichText.Content, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '' }),
          el(RichText.Content, { tagName: 'h2', id: 'maison-arrivals-title', value: attributes.heading || '' })
        ),
        el('div', { className: 'maison-filter-row', 'aria-label': 'Objet categories' },
          filters(attributes).map(function (filter, index) {
            return el('button', { key: index, type: 'button' }, filter);
          })
        ),
        el('div', { className: 'maison-object-grid' },
          items(attributes).map(function (item, index) {
            return objectCard(item, index, false);
          })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
