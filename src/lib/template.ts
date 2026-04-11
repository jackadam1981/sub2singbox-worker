import type { JsonObject, JsonValue, RenderContext } from "./types";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().replace(/[\s_-]+/g, "").toLowerCase();
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
    const objectResult: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      objectResult[key] = replacePlaceholders(item, context);
    }
    return objectResult;
  }

  if (typeof value === "string") {
    const match = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (!match) {
      return value;
    }

    switch (normalizeToken(match[1])) {
      case "nodes":
        return context.nodeOutbounds;
      case "nodenames":
      case "nodetags":
        return context.nodeOutbounds.map((node) => node.tag);
      case "profileid":
        return context.profile.id;
      case "device":
        return context.profile.device;
      case "versionchannel":
        return context.profile.channel;
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
      case "nodecount":
        return context.nodeOutbounds.length;
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
