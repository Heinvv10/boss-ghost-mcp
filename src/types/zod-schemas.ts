/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

/**
 * Zod Schema Type Definitions
 *
 * Provides type-safe wrappers for Zod schema operations to replace `any` casts
 * with properly typed alternatives. This module bridges schema definition and
 * extraction logic.
 */

/**
 * Zod Schema Shape - Type representation of object shape
 * Replaces Record<string, any> for schema definitions
 */
export type ZodSchemaShape = Record<string, zod.ZodTypeAny>;

/**
 * Zod Object Schema - Type-safe wrapper for ZodObject
 * Replaces zod.ZodObject<any> throughout the codebase
 */
export type ZodObjectSchema = zod.ZodObject<ZodSchemaShape>;

/**
 * Schema Field Definition - Represents a single field in a schema
 * Supports: string, number, boolean, array types
 */
export interface SchemaFieldDef {
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'string[]'
    | 'number[]'
    | 'boolean[]'
    | 'date'
    | 'unknown';
  optional: boolean;
}

/**
 * Extraction Result Type - Generic extraction output
 * Represents extracted data from LLM or DOM extraction
 */
export type ExtractionResult = Record<string, unknown>;

/**
 * Zod Schema Definition - Internal schema type representation
 * Used for accessing _def properties safely
 */
export interface ZodSchemaDef {
  type: string;
  element?: {_def?: {type?: string}};
  innerType?: {_def?: {type?: string}};
}

/**
 * Type guard for checking if a value is a ZodTypeAny
 */
export function isZodType(value: unknown): value is zod.ZodTypeAny {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_def' in value &&
    typeof (value as any)._def === 'object'
  );
}

/**
 * Safe schema shape accessor
 * Retrieves the shape property from a ZodObject schema safely
 */
export function getZodSchemaShape(
  schema: ZodObjectSchema
): ZodSchemaShape | null {
  if (!isZodType(schema)) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def;
  return def?.shape || null;
}

/**
 * Safe schema definition accessor
 * Retrieves the _def property from any Zod type
 * Note: We use 'any' here because Zod's _def is an internal property
 * not exposed in public type definitions
 */
export function getZodTypeDef(type: zod.ZodTypeAny): ZodSchemaDef | null {
  if (!isZodType(type)) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (type as any)._def as ZodSchemaDef;
}

/**
 * Build a Zod object schema from field definitions
 * Type-safe replacement for schema builder functions
 *
 * Note: Uses 'any' cast for zod.object() shape parameter because Zod's
 * ZodObject constructor expects Record<string, any> internally, even though
 * we're providing properly typed ZodTypeAny values. This is a bridge between
 * Zod's internal type system and our type-safe wrapper.
 */
export function buildZodObjectSchema(
  fields: Record<string, SchemaFieldDef>
): ZodObjectSchema {
  const shape: Record<string, zod.ZodTypeAny> = {};

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    let fieldSchema: zod.ZodTypeAny;

    // Build base schema based on type
    switch (fieldDef.type) {
      case 'string':
        fieldSchema = zod.string();
        break;
      case 'number':
        fieldSchema = zod.number();
        break;
      case 'boolean':
        fieldSchema = zod.boolean();
        break;
      case 'string[]':
        fieldSchema = zod.array(zod.string());
        break;
      case 'number[]':
        fieldSchema = zod.array(zod.number());
        break;
      case 'boolean[]':
        fieldSchema = zod.array(zod.boolean());
        break;
      case 'date':
        // Store dates as ISO strings
        fieldSchema = zod.string();
        break;
      default:
        // Default to string for unknown types
        fieldSchema = zod.string();
    }

    // Make optional if specified
    if (fieldDef.optional) {
      fieldSchema = fieldSchema.optional();
    }

    shape[fieldName] = fieldSchema;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zod.object(shape as any);
}

/**
 * Parse field type string into SchemaFieldDef
 * Handles suffixes: ?, [], etc.
 *
 * @example
 * parseFieldType('string') => { type: 'string', optional: false }
 * parseFieldType('string?') => { type: 'string', optional: true }
 * parseFieldType('number[]') => { type: 'number[]', optional: false }
 * parseFieldType('boolean[]?') => { type: 'boolean[]', optional: true }
 */
export function parseFieldType(typeString: string): SchemaFieldDef {
  const isOptional = typeString.endsWith('?');
  const baseType = isOptional ? typeString.slice(0, -1) : typeString;

  // Validate known types
  const knownTypes = [
    'string',
    'number',
    'boolean',
    'string[]',
    'number[]',
    'boolean[]',
    'date',
  ];
  const type = (
    knownTypes.includes(baseType) ? baseType : 'unknown'
  ) as SchemaFieldDef['type'];

  return {
    type,
    optional: isOptional,
  };
}

/**
 * Extract schema description from Zod schema
 * Converts internal Zod structure to human-readable format for LLMs
 *
 * Note: Accesses _def property which is internal to Zod, but is the only way
 * to introspect schema structure for LLM-friendly descriptions
 */
export function describeZodSchema(schema: ZodObjectSchema): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = (schema as any)?._def?.shape;
  if (!shape) {
    return '(Unable to describe schema)';
  }

  const fields: string[] = [];

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const def = getZodTypeDef(fieldSchema as zod.ZodTypeAny);
    if (!def) {
      fields.push(`  - ${fieldName}: (unknown type)`);
      continue;
    }

    const typeString = def.type || 'unknown';
    let typeDesc = typeString;

    // Handle optional types
    if (typeString === 'optional') {
      const innerDef =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        def.innerType ? getZodTypeDef(def.innerType as any) : null;
      const innerType = innerDef?.type || 'unknown';
      typeDesc = `optional ${innerType}`;
    }
    // Handle array types
    else if (typeString === 'array') {
      const elementDef =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        def.element ? getZodTypeDef(def.element as any) : null;
      const elementType = elementDef?.type || 'unknown';
      typeDesc = `array of ${elementType}s`;
    }

    fields.push(`  - ${fieldName}: ${typeDesc}`);
  }

  return fields.length > 0
    ? fields.join('\n')
    : '(No fields in schema)';
}

/**
 * Configuration Validation Schemas
 *
 * Provides Zod schemas for runtime validation of configuration objects.
 * These schemas ensure configuration is valid at entry points before use.
 */

/**
 * ExplorationConfig Schema - Validates autonomous exploration configuration
 *
 * Ensures all configuration values are within valid ranges and correct types.
 * Applied at exploration initialization time.
 */
export const ExplorationConfigSchema = zod.object({
  maxDepth: zod
    .number()
    .int()
    .min(1, 'maxDepth must be at least 1')
    .max(20, 'maxDepth must be at most 20')
    .default(3),
  maxPages: zod
    .number()
    .int()
    .min(1, 'maxPages must be at least 1')
    .max(1000, 'maxPages must be at most 1000')
    .default(50),
  followExternal: zod.boolean().default(false),
  ignorePatterns: zod
    .array(zod.string())
    .default([])
    .refine(
      patterns => {
        // Validate that all patterns are valid regex strings
        return patterns.every(pattern => {
          try {
            new RegExp(pattern);
            return true;
          } catch {
            return false;
          }
        });
      },
      {message: 'All ignorePatterns must be valid regex strings'},
    ),
  respectRobotsTxt: zod.boolean().default(true),
  captureScreenshots: zod.boolean().default(false),
  detectErrors: zod.boolean().default(true),
  timeout: zod
    .number()
    .int()
    .min(1000, 'timeout must be at least 1000ms')
    .max(300000, 'timeout must be at most 300000ms')
    .default(30000),
});

export type ValidatedExplorationConfig = zod.infer<
  typeof ExplorationConfigSchema
>;

/**
 * Request Parameters Schema - Validates MCP tool request parameters
 *
 * Ensures tool requests have valid structure before processing.
 */
export const McpToolRequestSchema = zod.object({
  method: zod
    .string()
    .min(1, 'method is required')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'method must be a valid identifier'),
  params: zod.record(zod.string(), zod.unknown()).optional(),
  timeout: zod
    .number()
    .int()
    .min(100, 'timeout must be at least 100ms')
    .max(300000, 'timeout must be at most 300000ms')
    .optional(),
});

export type ValidatedMcpToolRequest = zod.infer<typeof McpToolRequestSchema>;
