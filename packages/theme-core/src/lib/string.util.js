export function truncate(str, n) {
  return str.length > n ? str.substr(0, n - 1) : str;
}

export function parseUserAgent(userAgent, t = (key) => key) {
  if (!userAgent || userAgent === "-") return t("pages.settings.inputs.sessions.unknown");

  const ua = userAgent.toLowerCase();

  // Browser detection
  let browser = t("pages.settings.inputs.sessions.unknown-browser");
  if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("edg")) browser = "Edge";
  else if (ua.includes("chrome")) browser = "Chrome";
  else if (ua.includes("safari")) browser = "Safari";
  else if (ua.includes("opera") || ua.includes("opr")) browser = "Opera";

  // OS detection
  let os = t("pages.settings.inputs.sessions.unknown-os");
  if (ua.includes("win")) os = "Windows";
  else if (ua.includes("mac")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";

  return `${browser} (${os})`;
}