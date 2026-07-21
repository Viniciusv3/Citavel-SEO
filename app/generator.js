// ---------------------------------------------------------------------------
// Geração de posts (Fase A do plano — exportação manual, seção 3.1)
//
// Dois motores:
//  1. "ia"       — two-pass do plano (seção 4.3): Haiku extrai contexto do
//                  site, Sonnet escreve o post. Liga sozinho quando existe
//                  credencial Anthropic no ambiente (ANTHROPIC_API_KEY etc.).
//  2. "template" — determinístico, sem custo. Usa as respostas do PERFIL do
//                  negócio (formulário do painel + dados detectados no site);
//                  [PREENCHA: ...] só aparece no que ficou sem resposta.
// ---------------------------------------------------------------------------

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

// Conversor markdown→HTML mínimo (títulos, listas, negrito, parágrafos)
function mdParaHtml(md) {
  const linhas = md.split("\n");
  const out = [];
  let emLista = false;
  const inline = (t) =>
    t
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  for (const linha of linhas) {
    const l = linha.trim();
    if (/^[-*]\s+/.test(l)) {
      if (!emLista) { out.push("<ul>"); emLista = true; }
      out.push(`<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (emLista) { out.push("</ul>"); emLista = false; }
    if (/^###\s+/.test(l)) out.push(`<h3>${inline(l.replace(/^###\s+/, ""))}</h3>`);
    else if (/^##\s+/.test(l)) out.push(`<h2>${inline(l.replace(/^##\s+/, ""))}</h2>`);
    else if (/^#\s+/.test(l)) out.push(`<h1>${inline(l.replace(/^#\s+/, ""))}</h1>`);
    else if (l) out.push(`<p>${inline(l)}</p>`);
  }
  if (emLista) out.push("</ul>");
  return out.join("\n");
}

function montarFaqSchema(faq) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.pergunta,
      acceptedAnswer: { "@type": "Answer", text: f.resposta },
    })),
  };
}

// ---------------------------------------------------------------------------
// Motor 1 — templates determinísticos preenchidos pelo perfil
// ---------------------------------------------------------------------------

// valor do perfil, ou marcador [PREENCHA] se o dono ainda não respondeu
const v = (valor, placeholder) =>
  valor && String(valor).trim() ? String(valor).trim() : `[PREENCHA: ${placeholder}]`;

function contatoDe(p) {
  const canais = [p.whatsapp && `WhatsApp ${p.whatsapp}`, p.email, p.instagram]
    .filter(Boolean)
    .join(", ");
  return canais || null;
}

function listaDiferenciais(p) {
  const itens = (p.diferenciais || "")
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (itens.length) return itens.map((d) => `- ${d}`).join("\n");
  return `- [PREENCHA: diferencial 1]\n- [PREENCHA: diferencial 2]\n- [PREENCHA: diferencial 3]`;
}

const TEMPLATES = {
  "comercial:preco": (c, p) => ({
    titulo: `Quanto custa contratar a ${c.nome}? Preços e o que está incluso`,
    metaDescription: `Veja quanto custa contratar a ${c.nome}: valores, o que está incluso e como pedir um orçamento sem compromisso.`,
    corpoMarkdown: `## Quanto custa contratar a ${c.nome}?

${p.precoBase ? `Os valores partem de **${p.precoBase}**.` : `Essa é a primeira pergunta de quem chega até nós — e merece resposta direta: os valores partem de **[PREENCHA: preço/faixa de preço]**.`}${p.oQueFaz ? ` ${p.oQueFaz.trim().replace(/\.?$/, ".")}` : ""}

## O que está incluso

${listaDiferenciais(p)}

## Formas de pagamento

${v(p.pagamento, "Pix, cartão, boleto, parcelamento...")}

## Como pedir um orçamento

${p.comoComecar || `Fale com a gente pelo ${contatoDe(p) || "[PREENCHA: WhatsApp/telefone/formulário]"} e receba o orçamento sem compromisso.`}`,
    faq: [
      { pergunta: `Quanto custa o serviço da ${c.nome}?`, resposta: p.precoBase ? `Os valores partem de ${p.precoBase}. Peça um orçamento sem compromisso.` : "Os valores partem de [PREENCHA: preço]. Peça um orçamento sem compromisso." },
      { pergunta: "Quais formas de pagamento são aceitas?", resposta: v(p.pagamento, "Pix, cartão, boleto...") },
      { pergunta: "Como peço um orçamento?", resposta: p.comoComecar || (contatoDe(p) ? `Entre em contato pelo ${contatoDe(p)}.` : "[PREENCHA: primeiro passo do cliente].") },
    ],
  }),
  "comercial:como-funciona": (c, p) => ({
    titulo: `Como funciona a ${c.nome}? Passo a passo completo`,
    metaDescription: `Entenda como funciona a ${c.nome}: o que fazemos, para quem, e o passo a passo do primeiro contato à entrega.`,
    corpoMarkdown: `## Como funciona a ${c.nome}?

${v(p.oQueFaz, "descreva em 2-3 frases o que o negócio faz e para quem")}

## Para quem é

${v(p.publico, "descreva o cliente ideal")}

## Nossos diferenciais

${listaDiferenciais(p)}

## Como começar

${p.comoComecar || (contatoDe(p) ? `O primeiro passo é falar com a gente pelo ${contatoDe(p)}.` : "[PREENCHA: o primeiro passo concreto que o cliente deve dar]")}`,
    faq: [
      { pergunta: `Como começo com a ${c.nome}?`, resposta: p.comoComecar || (contatoDe(p) ? `Basta entrar em contato pelo ${contatoDe(p)} — conduzimos o resto com você.` : "[PREENCHA: primeiro passo].") },
      { pergunta: `O que a ${c.nome} faz?`, resposta: v(p.oQueFaz, "resposta direta em 1-2 frases") },
      { pergunta: "Para quem o serviço é indicado?", resposta: v(p.publico, "perfil de cliente") },
    ],
  }),
  "comercial:horario": (c, p) => ({
    titulo: `Horário de atendimento da ${c.nome}`,
    metaDescription: `Confira os horários de atendimento da ${c.nome} e todos os canais para falar com a equipe.`,
    corpoMarkdown: `## Qual o horário de atendimento da ${c.nome}?

${v(p.horario, "ex.: segunda a sexta, das 9h às 18h")}

## Canais de atendimento

${contatoDe(p) ? `Fale com a gente por: **${contatoDe(p)}**.` : "- **WhatsApp:** [PREENCHA: número]\n- **E-mail:** [PREENCHA: e-mail]"}

## E fora do horário?

Pode mandar mensagem a qualquer hora — respondemos assim que o atendimento abrir.`,
    faq: [
      { pergunta: `Qual o horário de atendimento da ${c.nome}?`, resposta: v(p.horario, "horário") },
      { pergunta: "Posso mandar mensagem fora do horário?", resposta: "Pode — respondemos assim que o atendimento abrir." },
      { pergunta: "Quais os canais de contato?", resposta: contatoDe(p) || "[PREENCHA: canais de contato]." },
    ],
  }),
  "comercial:endereco": (c, p) => ({
    titulo: `Onde fica a ${c.nome}? Endereço e como chegar`,
    metaDescription: `Veja onde fica a ${c.nome}, como chegar e como falar com a equipe antes da visita.`,
    corpoMarkdown: `## Onde fica a ${c.nome}?

${v(p.endereco, "endereço completo — ou 'atendimento 100% online'")}

## Antes de visitar

${p.horario ? `Nosso atendimento funciona ${p.horario}.` : "[PREENCHA: horário de atendimento]"} ${contatoDe(p) ? `Se quiser confirmar algo antes, fale com a gente: ${contatoDe(p)}.` : ""}

## Atendemos também a distância?

${v(p.publico, "sim/não — área de cobertura ou atendimento online")}`,
    faq: [
      { pergunta: `Qual o endereço da ${c.nome}?`, resposta: v(p.endereco, "endereço completo") },
      { pergunta: "Qual o horário de funcionamento?", resposta: v(p.horario, "horário") },
      { pergunta: "Como confirmo antes de ir?", resposta: contatoDe(p) ? `Fale com a gente pelo ${contatoDe(p)}.` : "[PREENCHA: canal de contato]." },
    ],
  }),
  "comercial:pagamento": (c, p) => ({
    titulo: `Formas de pagamento aceitas na ${c.nome}`,
    metaDescription: `Saiba como pagar na ${c.nome}: formas de pagamento, parcelamento e condições — explicado de forma direta.`,
    corpoMarkdown: `## Quais formas de pagamento a ${c.nome} aceita?

${v(p.pagamento, "Pix, cartão de crédito (até Nx), débito, boleto...")}

${p.precoBase ? `## Quanto custa\n\nOs valores partem de **${p.precoBase}**.\n` : ""}
## Dúvidas sobre pagamento

${contatoDe(p) ? `Fale com a gente pelo ${contatoDe(p)} antes de fechar — respondemos rápido.` : "[PREENCHA: canal para tirar dúvidas]"}`,
    faq: [
      { pergunta: `Quais as formas de pagamento da ${c.nome}?`, resposta: v(p.pagamento, "formas de pagamento") },
      { pergunta: "Dá pra parcelar?", resposta: p.pagamento?.match(/parcel|cart[ãa]o|\d+x/i) ? p.pagamento : "[PREENCHA: condições de parcelamento]." },
      { pergunta: "Quanto custa?", resposta: p.precoBase ? `Os valores partem de ${p.precoBase}.` : "[PREENCHA: faixa de preço]." },
    ],
  }),
  "comercial:garantia": (c, p) => ({
    titulo: `Garantia e política de trocas da ${c.nome}`,
    metaDescription: `Conheça a garantia e a política de trocas da ${c.nome}: prazos, condições e como acionar.`,
    corpoMarkdown: `## Qual a garantia da ${c.nome}?

${v(p.garantia, "prazo e tipo de garantia — ex.: 90 dias em todos os serviços")}

## Como acionar a garantia ou pedir troca

${contatoDe(p) ? `Entre em contato pelo ${contatoDe(p)} com o comprovante — conduzimos o resto.` : "- **1.** Entre em contato pelo [PREENCHA: canal]\n- **2.** [PREENCHA: o que apresentar]\n- **3.** [PREENCHA: prazo de resolução]"}

## Por que isso importa

Garantia clara é confiança antes da compra — na ${c.nome}, você sabe exatamente com o que contar antes de fechar.`,
    faq: [
      { pergunta: `Qual o prazo de garantia da ${c.nome}?`, resposta: v(p.garantia, "prazo e condições") },
      { pergunta: "Como peço uma troca?", resposta: contatoDe(p) ? `Entre em contato pelo ${contatoDe(p)} com o comprovante.` : "[PREENCHA: como acionar]." },
      { pergunta: "A troca tem custo?", resposta: "[PREENCHA: condições de custo da troca]." },
    ],
  }),
  blog: (c, p) => ({
    titulo: `${c.nome}: guia completo para quem está conhecendo agora`,
    metaDescription: `Conheça a ${c.nome}: o que fazemos, para quem, diferenciais e como começar — tudo em uma página.`,
    corpoMarkdown: `## O que é a ${c.nome} e o que ela faz?

${v(p.oQueFaz || c.descricao, "descreva em 2-3 frases o que o negócio faz e para quem")}

## Para quem é

${v(p.publico, "descreva o cliente ideal — quem mais se beneficia")}

## Por que escolher a ${c.nome}

${listaDiferenciais(p)}

## Como começar

${p.comoComecar || (contatoDe(p) ? `O primeiro passo é simples: fale com a gente pelo ${contatoDe(p)}.` : "[PREENCHA: o primeiro passo concreto que o leitor deve dar]")}`,
    faq: [
      { pergunta: `O que a ${c.nome} faz?`, resposta: v(p.oQueFaz || c.descricao, "resposta direta em 1-2 frases") },
      { pergunta: `Para quem a ${c.nome} é indicada?`, resposta: v(p.publico, "perfil de cliente") },
      { pergunta: "Como entro em contato?", resposta: contatoDe(p) || "[PREENCHA: canais de contato]." },
    ],
  }),
};
// FAQ, perguntas e substância usam o mesmo esqueleto do post institucional
TEMPLATES.faq = TEMPLATES.blog;
TEMPLATES.perguntas = TEMPLATES.blog;
TEMPLATES.substancia = TEMPLATES.blog;

function gerarComTemplate(contexto, gap, perfil) {
  const fn = TEMPLATES[gap.id] || TEMPLATES.blog;
  return fn(contexto, perfil);
}

// ---------------------------------------------------------------------------
// Motor 2 — IA (two-pass Haiku → Sonnet, conforme seção 4.3 do plano)
// ---------------------------------------------------------------------------
let clientePromise = null;
async function obterCliente() {
  if (!clientePromise) {
    clientePromise = (async () => {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      return new Anthropic(); // resolve credencial do ambiente (API key ou perfil)
    })().catch(() => null);
  }
  return clientePromise;
}

const SCHEMA_POST = {
  type: "object",
  properties: {
    titulo: { type: "string" },
    metaDescription: { type: "string" },
    corpoMarkdown: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: { pergunta: { type: "string" }, resposta: { type: "string" } },
        required: ["pergunta", "resposta"],
        additionalProperties: false,
      },
    },
  },
  required: ["titulo", "metaDescription", "corpoMarkdown", "faq"],
  additionalProperties: false,
};

async function gerarComIA(contexto, gap, perfil) {
  const client = await obterCliente();
  if (!client) return null;

  // Passo 1 — Haiku extrai o contexto do negócio (plano usa Haiku por custo)
  const extracao = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Extraia do texto abaixo, em 5-8 linhas: nome do negócio, nicho, público-alvo, serviços/produtos, tom de voz e diferenciais aparentes.\n\nSite: ${contexto.dominio}\nDescrição: ${contexto.descricao}\n\nTexto do site:\n${contexto.resumoTexto}`,
    }],
  });
  const perfilIA = extracao.content.find((b) => b.type === "text")?.text || "";

  const respostasDono = Object.entries(perfil || {})
    .filter(([, valor]) => valor && String(valor).trim())
    .map(([campo, valor]) => `- ${campo}: ${valor}`)
    .join("\n");

  // Passo 2 — Sonnet escreve o post completo, estruturado p/ AEO/GEO
  // (modelos definidos na seção 4.3 do PLANO.md)
  const resposta = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    output_config: { format: { type: "json_schema", schema: SCHEMA_POST } },
    messages: [{
      role: "user",
      content: `Você escreve posts de blog otimizados para SEO/AEO/GEO em português do Brasil.

Perfil do negócio (extraído do site):
${perfilIA}

Respostas do dono do negócio (use como fonte da verdade):
${respostasDono || "(nenhuma resposta ainda)"}

Pauta: ${gap.titulo}${gap.pergunta ? `\nPergunta central a responder: "${gap.pergunta}"` : ""}

Escreva um post completo: título com a palavra-chave, meta description de 130-155 caracteres, corpo em Markdown com H2 em formato de pergunta, respostas diretas no primeiro parágrafo de cada seção, listas onde couber, e 3-4 FAQs no final. Use os dados do dono sempre que existirem; só use o marcador [PREENCHA: ...] quando a informação não estiver em lugar nenhum.`,
    }],
  });
  const texto = resposta.content.find((b) => b.type === "text")?.text;
  if (!texto) return null;
  return JSON.parse(texto);
}

// ---------------------------------------------------------------------------
export async function gerarPost(contexto, gap, perfil = {}) {
  let bruto = null;
  let motor = "template";
  try {
    bruto = await gerarComIA(contexto, gap, perfil);
    if (bruto) motor = "ia";
  } catch {
    bruto = null; // sem credencial ou erro de API → template
  }
  if (!bruto) bruto = gerarComTemplate(contexto, gap, perfil);

  const faqSchema = montarFaqSchema(bruto.faq);
  const corpoHtml = mdParaHtml(bruto.corpoMarkdown);
  const slug = slugify(bruto.titulo);
  const pendencias = (bruto.corpoMarkdown.match(/\[PREENCHA:/g) || []).length;

  const markdownCompleto = `---
title: "${bruto.titulo}"
description: "${bruto.metaDescription}"
slug: ${slug}
---

${bruto.corpoMarkdown}

## Perguntas frequentes

${bruto.faq.map((f) => `**${f.pergunta}**\n\n${f.resposta}`).join("\n\n")}
`;

  const htmlCompleto = `<article>
<h1>${bruto.titulo}</h1>
${corpoHtml}
<section>
<h2>Perguntas frequentes</h2>
${bruto.faq.map((f) => `<h3>${f.pergunta}</h3>\n<p>${f.resposta}</p>`).join("\n")}
</section>
</article>
<script type="application/ld+json">
${JSON.stringify(faqSchema, null, 2)}
</script>`;

  return {
    motor,
    pendencias,
    titulo: bruto.titulo,
    metaDescription: bruto.metaDescription,
    slug,
    faq: bruto.faq,
    corpoMarkdown: bruto.corpoMarkdown,
    markdownCompleto,
    htmlCompleto,
    faqSchema,
  };
}
