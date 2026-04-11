import type { JsonObject, JsonValue, RenderContext } from "./types";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().replace(/[\s_-]+/g, "").toLowerCase();
}

function cleanArgumentValue(value: string): string {
  return value.trim().replace(/,$/, "").trim();
}

function getStringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getBooleanValue(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getNumberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringList(value: JsonValue | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    const result = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return result.length > 0 ? result : undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const result = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return result.length > 0 ? result : undefined;
  }

  return undefined;
}

function compileRegex(pattern: string | undefined, label: string): RegExp | null {
  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(pattern);
  } catch {
    throw new Error(`模板 ${label} 正则无效: ${pattern}`);
  }
}

function selectNodes(
  context: RenderContext,
  options: {
    include?: string;
    exclude?: string;
    limit?: number;
  },
) {
  const include = compileRegex(options.include, "include");
  const exclude = compileRegex(options.exclude, "exclude");

  let result = context.nodeOutbounds.filter((node) => {
    if (include && !include.test(node.tag)) {
      return false;
    }
    if (exclude && exclude.test(node.tag)) {
      return false;
    }
    return true;
  });

  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit >= 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}

function parseArgumentString(input: string): Record<string, string> {
  const args: Record<string, string> = {};
  const parts = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    let rawValue = cleanArgumentValue(part.slice(separator + 1));
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1);
    }
    args[normalizeToken(key)] = rawValue;
  }

  return args;
}

function parsePlaceholder(value: string): { token: string; args: Record<string, string> } | null {
  const match = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (!match) {
    return null;
  }

  const inner = match[1].trim();
  const callMatch = inner.match(/^([A-Za-z][\w-]*)\((.*)\)$/);
  const spacedMatch = inner.match(/^([A-Za-z][\w-]*)([\s\S]*)$/);
  const rawToken = callMatch?.[1] ?? spacedMatch?.[1];
  if (!rawToken) {
    return null;
  }

  const argString = callMatch
    ? callMatch[2].trim()
    : (spacedMatch?.[2] ?? "").trim();
  return {
    token: normalizeToken(rawToken),
    args: parseArgumentString(argString),
  };
}

function parseListArgument(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveNodeTagsFromArgs(
  context: RenderContext,
  args: Record<string, string>,
): string[] {
  const nodes = selectNodes(context, {
    include: args.include ?? args.filter ?? args.match,
    exclude: args.exclude,
    limit: args.limit ? Number(args.limit) : undefined,
  });
  const tags = nodes.map((node) => node.tag);
  const append = parseListArgument(args.append);
  const fallback = parseListArgument(args.fallback);

  if (tags.length > 0) {
    return [...tags, ...append];
  }

  if (fallback.length > 0) {
    return [...fallback, ...append];
  }

  return append;
}

function resolveNodesFromArgs(
  context: RenderContext,
  args: Record<string, string>,
) {
  return selectNodes(context, {
    include: args.include ?? args.filter ?? args.match,
    exclude: args.exclude,
    limit: args.limit ? Number(args.limit) : undefined,
  });
}

function buildGeneratedOutboundGroup(
  definition: JsonObject,
  context: RenderContext,
  inherited?: {
    groupType?: string;
    fallback?: string[];
    append?: string[];
    url?: string;
    interval?: string;
    tolerance?: number;
  },
): JsonObject {
  const tag = getStringValue(definition.tag);
  if (!tag) {
    throw new Error("模板 outboundGroup 缺少 tag");
  }

  const groupType = normalizeToken(
    getStringValue(definition.group_type) ??
      getStringValue(definition.type) ??
      inherited?.groupType ??
      "selector",
  );

  const matchedTags = selectNodes(context, {
    include: getStringValue(definition.include) ?? getStringValue(definition.match),
    exclude: getStringValue(definition.exclude),
    limit: getNumberValue(definition.limit),
  }).map((node) => node.tag);

  const fallback = getStringList(definition.fallback) ?? inherited?.fallback ?? ["direct"];
  const append = getStringList(definition.append) ?? inherited?.append ?? [];
  const outbounds = matchedTags.length > 0 ? [...matchedTags, ...append] : [...fallback, ...append];

  if (groupType === "urltest") {
    return {
      type: "urltest",
      tag,
      outbounds,
      url:
        getStringValue(definition.url) ??
        inherited?.url ??
        "https://www.gstatic.com/generate_204",
      interval: getStringValue(definition.interval) ?? inherited?.interval ?? "10m",
      tolerance: getNumberValue(definition.tolerance) ?? inherited?.tolerance ?? 50,
      interrupt_exist_connections:
        getBooleanValue(definition.interrupt_exist_connections) ?? true,
    };
  }

  return {
    type: "selector",
    tag,
    outbounds,
    interrupt_exist_connections:
      getBooleanValue(definition.interrupt_exist_connections) ?? true,
  };
}

function renderDirective(value: JsonObject, context: RenderContext): JsonValue | undefined {
  const templateName = getStringValue(value.$template);
  if (!templateName) {
    return undefined;
  }

  switch (normalizeToken(templateName)) {
    case "outboundgroup":
      return buildGeneratedOutboundGroup(value, context);
    case "outboundgroups": {
      const definitions = Array.isArray(value.definitions)
        ? value.definitions.filter(isJsonObject)
        : [];
      const inherited = {
        groupType: getStringValue(value.group_type) ?? getStringValue(value.type),
        fallback: getStringList(value.fallback),
        append: getStringList(value.append),
        url: getStringValue(value.url),
        interval: getStringValue(value.interval),
        tolerance: getNumberValue(value.tolerance),
      };
      return definitions.map((definition) =>
        buildGeneratedOutboundGroup(definition, context, inherited),
      );
    }
    default:
      return undefined;
  }
}

function replacePlaceholders(
  value: JsonValue,
  context: RenderContext,
): JsonValue {
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      const replaced = replacePlaceholders(item, context);
      if (Array.isArray(replaced)) {
        result.push(...replaced);
      } else {
        result.push(replaced);
      }
    }
    return result;
  }

  if (isJsonObject(value)) {
    const directiveResult = renderDirective(value, context);
    if (directiveResult !== undefined) {
      return directiveResult;
    }

    const objectResult: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      objectResult[key] = replacePlaceholders(item, context);
    }
    return objectResult;
  }

  if (typeof value === "string") {
    const placeholder = parsePlaceholder(value);
    if (!placeholder) {
      return value;
    }

    switch (placeholder.token) {
      case "nodes":
        return resolveNodesFromArgs(context, placeholder.args);
      case "nodenames":
      case "nodetags":
        return resolveNodeTagsFromArgs(context, placeholder.args);
      case "group":
        return buildGeneratedOutboundGroup({
          tag: placeholder.args.tag ?? "Group",
          group_type: placeholder.args.type ?? "selector",
          include: placeholder.args.include ?? placeholder.args.filter ?? placeholder.args.match,
          exclude: placeholder.args.exclude,
          fallback: parseListArgument(placeholder.args.fallback),
          append: parseListArgument(placeholder.args.append),
          interval: placeholder.args.interval,
          url: placeholder.args.url,
          ...(placeholder.args.tolerance
            ? { tolerance: Number(placeholder.args.tolerance) }
            : {}),
        }, context);
      case "urltest":
        return buildGeneratedOutboundGroup({
          tag: placeholder.args.tag ?? "Auto",
          group_type: "urltest",
          include: placeholder.args.include ?? placeholder.args.filter ?? placeholder.args.match,
          exclude: placeholder.args.exclude,
          fallback: parseListArgument(placeholder.args.fallback),
          append: parseListArgument(placeholder.args.append),
          interval: placeholder.args.interval,
          url: placeholder.args.url,
          ...(placeholder.args.tolerance
            ? { tolerance: Number(placeholder.args.tolerance) }
            : {}),
        }, context);
      case "profileid":
        return context.profile.id;
      case "device":
        return context.profile.device;
      case "versionchannel":
        return context.profile.channel;
      case "nodecount":
        return resolveNodesFromArgs(context, placeholder.args).length;
      case "dns":
        return context.dns;
      case "inbounds":
        return context.inbounds;
      case "selectoroutbounds":
        return context.selectorOutbounds;
      case "alloutbounds":
        return context.allOutbounds;
      case "route":
        return context.route;
      case "experimental":
        return context.experimental;
      default:
        return value;
    }
  }

  return value;
}

export function renderTemplate(
  templateText: string,
  context: RenderContext,
): JsonObject {
  const parsed = JSON.parse(templateText) as JsonValue;
  const rendered = replacePlaceholders(parsed, context);

  if (!isJsonObject(rendered)) {
    throw new Error("模板渲染结果必须是 JSON 对象");
  }

  return rendered;
}

export function buildTemplateContext(context: RenderContext): RenderContext {
  return context;
}
