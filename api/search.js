export default async function handler(req, res) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Missing query ?q=" });

    const key = process.env.GOOGLE_API_KEY;
    const cx  = process.env.GOOGLE_CSE_CX;
    if (!key || !cx) return res.status(500).json({ error: "Missing API env vars" });

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", q);
    url.searchParams.set("num", "5");
    url.searchParams.set("safe", "active");

    const r = await fetch(url);
    const data = await r.json();

    const items = (data.items || []).map(it => ({
      title: it.title,
      snippet: it.snippet,
      link: it.link,
      displayLink: it.displayLink,
    }));

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
