// Schema validation shared by every harness. Kept in its own module so
// base.mjs can import it without a cycle through harness/index.mjs.

import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

// Validate a structured payload against a step schema. Returns a short,
// prompt-safe error string on failure (fed back to the model on retry).
export function validateAgainstSchema(schema, data) {
    if (!schema) return { valid: true };
    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (valid) return { valid: true };
    const errors = (validate.errors || [])
        .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
        .slice(0, 12)
        .join('; ');
    return { valid: false, errors };
}

export default validateAgainstSchema;
