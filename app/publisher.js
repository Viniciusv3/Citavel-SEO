// ---------------------------------------------------------------------------
// Publicação por canal (seção 4.5 do plano — steps independentes por destino)
//
//  - "manual"     : nada a fazer no servidor — o cliente copia/baixa o post.
//  - "wordpress"  : Fase B (3.2) — publica via REST API com Application
//                   Password. O post nasce no tema do cliente.
//  - "hospedado"  : Fase C/3.4 — o post fica servido por nós em /b/:id/:slug
//                   com o tema configurado; o cliente pode apontar
//                   sitecliente.com/blog/* para cá via rewrite (proxy reverso).
// ---------------------------------------------------------------------------

function authBasica(usuario, senha) {
  return "Basic " + Buffer.from(`${usuario}:${senha}`).toString("base64");
}

function baseWp(url) {
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return u.replace(/\/+$/, "");
}

export async function testarWordpress({ url, usuario, senha }) {
  const r = await fetch(`${baseWp(url)}/wp-json/wp/v2/users/me`, {
    headers: { Authorization: authBasica(usuario, senha) },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new Error(
      r.status === 401
        ? "Credenciais recusadas — confira o usuário e a Application Password."
        : `WordPress respondeu HTTP ${r.status}. ${corpo.slice(0, 120)}`
    );
  }
  const me = await r.json();
  return { ok: true, usuario: me.name || usuario };
}

export async function publicarWordpress({ url, usuario, senha }, post) {
  const r = await fetch(`${baseWp(url)}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: authBasica(usuario, senha),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: post.titulo,
      slug: post.slug,
      status: "publish",
      excerpt: post.metaDescription,
      content: post.htmlCompleto,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new Error(`Falha ao publicar no WordPress (HTTP ${r.status}). ${corpo.slice(0, 160)}`);
  }
  const criado = await r.json();
  return { ok: true, link: criado.link || null, wpId: criado.id };
}

// Publica um post conforme o modo de entrega do cliente.
// Devolve { canal, link } — para "hospedado" o link é a rota local.
export async function publicar(cliente, post) {
  const modo = cliente.entrega?.modo || "manual";
  if (modo === "wordpress") {
    if (!cliente.entrega?.wp?.url) throw new Error("Configure a conexão WordPress do cliente antes de publicar.");
    const res = await publicarWordpress(cliente.entrega.wp, post);
    return { canal: "wordpress", link: res.link };
  }
  if (modo === "hospedado") {
    return { canal: "hospedado", link: `/b/${cliente.id}/${post.slug}` };
  }
  // manual: a entrega é a exportação, mas a prévia hospedada serve de link
  return { canal: "manual", link: `/b/${cliente.id}/${post.slug}` };
}

// Snippet de Cloudflare Worker para o proxy reverso da Fase C (3.3):
// o cliente cola isso 1x e sitecliente.com/blog/* passa a servir nosso conteúdo
// no domínio dele (autoridade SEO no domínio principal).
export function snippetProxy(cliente, origemPublica) {
  return `// Cloudflare Worker — rota: sitecliente.com/blog/*
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const destino = new URL(url.pathname.replace(/^\\/blog/, "/b/${cliente.id}"), "${origemPublica}");
    const resposta = await fetch(destino, { headers: { "X-Proxy-De": url.hostname } });
    return new Response(resposta.body, resposta);
  }
};`;
}
