// ---------------------------------------------------------------------------
// Kit de Correção — soluções técnicas prontas para colar.
// O blog resolve o gap de CONTEÚDO; este kit resolve os gaps TÉCNICOS que o
// diagnóstico aponta: meta tags, dados estruturados, robots.txt e llms.txt.
// Tudo determinístico, gerado a partir do contexto real do site.
// ---------------------------------------------------------------------------

export function gerarKit(resultado) {
  const c = resultado.contexto;
  const url = resultado.url.replace(/\/+$/, "");
  const origem = new URL(resultado.url).origin;
  const falhas = new Set(
    resultado.checks.filter((x) => x.status !== "ok").map((x) => x.id)
  );

  const titulo = `${c.nome} — ${c.descricao ? c.descricao.slice(0, 40) : "[PREENCHA: o que você faz + cidade]"}`.slice(0, 60);
  const descricao =
    c.descricao ||
    `[PREENCHA: descreva em ~150 caracteres o que a ${c.nome} faz, para quem, e um motivo para clicar]`;

  const itens = [];

  // 1. Meta tags essenciais (title, description, OG, canonical, viewport)
  itens.push({
    id: "meta",
    titulo: "Meta tags essenciais",
    prioridade:
      falhas.has("title") || falhas.has("meta-desc") || falhas.has("og") ? "alta" : "ok",
    onde: "Dentro do <head> de cada página (ajuste título/descrição por página).",
    porque:
      "Title e meta description são o seu anúncio grátis no Google; Open Graph controla como o link aparece no WhatsApp/Instagram.",
    codigo: `<title>${titulo}</title>
<meta name="description" content="${descricao}">
<link rel="canonical" href="${url}/">
<meta name="viewport" content="width=device-width, initial-scale=1">

<!-- Open Graph (compartilhamento) -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${c.nome}">
<meta property="og:title" content="${titulo}">
<meta property="og:description" content="${descricao}">
<meta property="og:url" content="${url}/">
<meta property="og:image" content="${origem}/[PREENCHA: caminho-da-imagem-1200x630].jpg">`,
  });

  // 2. Dados estruturados Organization/LocalBusiness
  itens.push({
    id: "schema",
    titulo: "Dados estruturados (schema.org)",
    prioridade: falhas.has("schema") ? "alta" : "ok",
    onde: "Antes do </body> da página inicial.",
    porque:
      "É como Google e IAs entendem O QUE o site é. Sem isso, você é texto solto; com isso, é uma entidade identificável e citável.",
    codigo: `<script type="application/ld+json">
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: c.nome,
    url: `${url}/`,
    description: c.descricao || "[PREENCHA: descrição do negócio]",
    telephone: "[PREENCHA: +55 11 99999-9999]",
    address: {
      "@type": "PostalAddress",
      streetAddress: "[PREENCHA: rua e número]",
      addressLocality: "[PREENCHA: cidade]",
      addressRegion: "[PREENCHA: UF]",
      postalCode: "[PREENCHA: CEP]",
      addressCountry: "BR",
    },
    openingHours: "[PREENCHA: Mo-Fr 09:00-18:00]",
    sameAs: ["[PREENCHA: link do Instagram]", "[PREENCHA: link do Google Maps]"],
  },
  null,
  2
)}
</script>`,
  });

  // 3. robots.txt
  itens.push({
    id: "robots",
    titulo: "robots.txt",
    prioridade: falhas.has("robots") || falhas.has("sitemap") ? "media" : "ok",
    onde: `Arquivo em ${origem}/robots.txt`,
    porque:
      "Orienta os robôs (Google e crawlers de IA) e aponta o sitemap. A ausência não bloqueia, mas a presença acelera a descoberta do site.",
    codigo: `User-agent: *
Allow: /

# Crawlers de IA — permitir ser lido é ser citável
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /

Sitemap: ${origem}/sitemap.xml`,
  });

  // 4. llms.txt — o "robots.txt das IAs" (GEO puro)
  itens.push({
    id: "llms",
    titulo: "llms.txt (novo padrão para IAs)",
    prioridade: falhas.has("llms") ? "alta" : "ok",
    onde: `Arquivo em ${origem}/llms.txt`,
    porque:
      "Padrão emergente que resume seu site para LLMs em texto puro — ChatGPT/Perplexity encontram e citam suas informações sem depender de renderização.",
    codigo: `# ${c.nome}

> ${c.descricao || "[PREENCHA: uma frase objetiva sobre o que o negócio faz e para quem]"}

## Informações principais

- Site: ${url}/
- O que fazemos: [PREENCHA: serviços/produtos em 1 linha]
- Onde atendemos: [PREENCHA: cidade/região ou "todo o Brasil"]
- Contato: [PREENCHA: WhatsApp/e-mail]

## Páginas importantes

- [Página inicial](${url}/): visão geral
- [PREENCHA: [Serviços](${url}/servicos): descrição]
- [PREENCHA: [Contato](${url}/contato): como falar com a gente]`,
  });

  // 5. FAQ schema pronto (se o site não tem)
  if (falhas.has("faq-schema") || falhas.has("faq-page")) {
    itens.push({
      id: "faq",
      titulo: "FAQ schema (featured snippets)",
      prioridade: "media",
      onde: "Antes do </body> da página que contém as perguntas e respostas.",
      porque:
        "Perguntas marcadas com FAQPage são elegíveis a aparecer direto no resultado do Google e alimentam o People Also Ask.",
      codigo: `<script type="application/ld+json">
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Quanto custa o serviço da ${c.nome}?`,
        acceptedAnswer: { "@type": "Answer", text: "[PREENCHA: resposta direta em 1-2 frases]" },
      },
      {
        "@type": "Question",
        name: `Como funciona o atendimento da ${c.nome}?`,
        acceptedAnswer: { "@type": "Answer", text: "[PREENCHA: resposta direta]" },
      },
      {
        "@type": "Question",
        name: `Onde a ${c.nome} atende?`,
        acceptedAnswer: { "@type": "Answer", text: "[PREENCHA: resposta direta]" },
      },
    ],
  },
  null,
  2
)}
</script>`,
    });
  }

  return {
    site: c.nome,
    url: resultado.url,
    nota: resultado.nota,
    itens,
  };
}
