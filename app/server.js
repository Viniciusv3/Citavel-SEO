import express from "express";
import * as cheerio from "cheerio";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gerarPost } from "./generator.js";
import { gerarKit } from "./kit.js";
import { listarClientes, obterCliente, criarCliente, atualizarCliente, persistir } from "./store.js";
import { publicar, testarWordpress, snippetProxy } from "./publisher.js";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Rate limit simples por IP (plano, seção 2: "Rate-limit por IP desde o dia 1")
// ---------------------------------------------------------------------------
const hits = new Map();
const RATE_LIMIT = 10; // análises por IP por janela
const WINDOW_MS = 10 * 60 * 1000;

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  hits.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// Fetch com timeout e user-agent próprio
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, ms = 12000, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CitavelBot/0.1; diagnostico SEO/AEO/GEO)",
        Accept: "text/html,application/xhtml+xml,*/*",
        ...opts.headers,
      },
    });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Motor de checks — Camada 1 (determinística, sem IA)
// Cada check devolve: { id, categoria, titulo, status, peso, detalhe, dica }
// status: "ok" | "aviso" | "erro"
// ---------------------------------------------------------------------------
async function diagnose(rawUrl) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw Object.assign(new Error("URL inválida"), { status: 400 });
  }

  const started = Date.now();
  let res;
  try {
    res = await fetchWithTimeout(url.href);
  } catch (e) {
    throw Object.assign(
      new Error(
        e.name === "AbortError"
          ? "O site demorou mais de 12s para responder"
          : `Não consegui acessar o site (${e.cause?.code || e.message})`
      ),
      { status: 502 }
    );
  }
  const ttfbMs = Date.now() - started;
  const finalUrl = new URL(res.url);
  const html = await res.text();
  const htmlKb = Math.round(Buffer.byteLength(html) / 1024);
  const $ = cheerio.load(html);
  const checks = [];

  const add = (c) => checks.push(c);

  // ---------- SEO técnico ----------
  add({
    id: "https",
    categoria: "SEO",
    titulo: "HTTPS",
    peso: 8,
    ...(finalUrl.protocol === "https:"
      ? { status: "ok", detalhe: "Site servido via HTTPS." }
      : {
          status: "erro",
          detalhe: "Site final servido em HTTP puro.",
          dica: "Ative um certificado SSL — Google penaliza sites sem HTTPS e navegadores marcam como inseguro.",
        }),
  });

  add({
    id: "status",
    categoria: "SEO",
    titulo: "Resposta do servidor",
    peso: 6,
    ...(res.ok
      ? { status: "ok", detalhe: `HTTP ${res.status} em ${ttfbMs}ms.` }
      : {
          status: "erro",
          detalhe: `Servidor respondeu HTTP ${res.status}.`,
          dica: "A página principal deve responder 200. Erros 4xx/5xx impedem indexação.",
        }),
  });

  add({
    id: "velocidade",
    categoria: "SEO",
    titulo: "Tempo de resposta",
    peso: 5,
    ...(ttfbMs < 800
      ? { status: "ok", detalhe: `Resposta em ${ttfbMs}ms.` }
      : ttfbMs < 2500
      ? {
          status: "aviso",
          detalhe: `Resposta em ${ttfbMs}ms — aceitável, mas dá pra melhorar.`,
          dica: "Core Web Vitals favorecem TTFB abaixo de 800ms. Considere cache/CDN.",
        }
      : {
          status: "erro",
          detalhe: `Resposta lenta: ${ttfbMs}ms.`,
          dica: "Acima de 2,5s o Google considera a experiência ruim. Cache, CDN e otimização de servidor ajudam.",
        }),
  });

  // robots.txt + sitemap
  let robotsTxt = null;
  try {
    const r = await fetchWithTimeout(`${finalUrl.origin}/robots.txt`, 6000);
    if (r.ok) robotsTxt = await r.text();
  } catch {}
  add({
    id: "robots",
    categoria: "SEO",
    titulo: "robots.txt",
    peso: 5,
    ...(robotsTxt !== null
      ? robotsTxt.match(/^\s*Disallow:\s*\/\s*$/im) &&
        robotsTxt.match(/^\s*User-agent:\s*\*\s*$/im)
        ? {
            status: "erro",
            detalhe: "robots.txt existe mas bloqueia todos os robôs (Disallow: /).",
            dica: "Isso impede o Google de indexar o site inteiro. Remova o Disallow global.",
          }
        : { status: "ok", detalhe: "robots.txt presente e sem bloqueio global." }
      : {
          status: "aviso",
          detalhe: "robots.txt não encontrado.",
          dica: "Crie um robots.txt apontando para o sitemap — ajuda crawlers a navegar o site.",
        }),
  });

  let sitemapOk = false;
  const sitemapInRobots = robotsTxt?.match(/^\s*Sitemap:\s*(\S+)/im)?.[1];
  const sitemapCandidates = [
    sitemapInRobots,
    `${finalUrl.origin}/sitemap.xml`,
    `${finalUrl.origin}/sitemap_index.xml`,
  ].filter(Boolean);
  for (const cand of sitemapCandidates) {
    try {
      const r = await fetchWithTimeout(cand, 6000);
      if (r.ok) {
        const body = await r.text();
        if (/<(urlset|sitemapindex)/i.test(body)) {
          sitemapOk = true;
          break;
        }
      }
    } catch {}
  }
  add({
    id: "sitemap",
    categoria: "SEO",
    titulo: "Sitemap XML",
    peso: 5,
    ...(sitemapOk
      ? { status: "ok", detalhe: "Sitemap encontrado e válido." }
      : {
          status: "aviso",
          detalhe: "Nenhum sitemap.xml encontrado.",
          dica: "Um sitemap acelera a descoberta de páginas novas pelo Google. Declare-o também no robots.txt.",
        }),
  });

  // Title
  const title = $("head > title").first().text().trim();
  add({
    id: "title",
    categoria: "SEO",
    titulo: "Tag <title>",
    peso: 8,
    ...(!title
      ? {
          status: "erro",
          detalhe: "Página sem <title>.",
          dica: "O title é o fator on-page mais básico — é o texto azul do resultado no Google.",
        }
      : title.length < 15
      ? {
          status: "aviso",
          detalhe: `Title muito curto (${title.length} caracteres): “${title}”.`,
          dica: "Entre 30 e 60 caracteres, incluindo a palavra-chave principal.",
        }
      : title.length > 65
      ? {
          status: "aviso",
          detalhe: `Title longo (${title.length} caracteres) — será cortado no Google.`,
          dica: "Mantenha até ~60 caracteres para não truncar no resultado de busca.",
        }
      : { status: "ok", detalhe: `“${title}” (${title.length} caracteres).` }),
  });

  // Meta description
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || "";
  add({
    id: "meta-desc",
    categoria: "SEO",
    titulo: "Meta description",
    peso: 6,
    ...(!metaDesc
      ? {
          status: "erro",
          detalhe: "Sem meta description.",
          dica: "O Google gera um texto aleatório da página quando falta — você perde controle sobre o “anúncio grátis” do resultado.",
        }
      : metaDesc.length < 70
      ? {
          status: "aviso",
          detalhe: `Meta description curta (${metaDesc.length} caracteres).`,
          dica: "Entre 120 e 160 caracteres, com chamada para ação.",
        }
      : metaDesc.length > 165
      ? {
          status: "aviso",
          detalhe: `Meta description longa (${metaDesc.length} caracteres) — será cortada.`,
          dica: "Mantenha até ~160 caracteres.",
        }
      : { status: "ok", detalhe: `${metaDesc.length} caracteres — dentro do ideal.` }),
  });

  // H1 / hierarquia
  const h1s = $("h1");
  add({
    id: "h1",
    categoria: "SEO",
    titulo: "Hierarquia de títulos (H1)",
    peso: 6,
    ...(h1s.length === 0
      ? {
          status: "erro",
          detalhe: "Nenhum H1 na página.",
          dica: "Todo documento precisa de exatamente um H1 dizendo do que a página trata.",
        }
      : h1s.length > 1
      ? {
          status: "aviso",
          detalhe: `${h1s.length} H1s na página.`,
          dica: "Use um único H1; os demais títulos devem ser H2/H3 em ordem.",
        }
      : { status: "ok", detalhe: `H1 único: “${h1s.first().text().trim().slice(0, 80)}”.` }),
  });

  // Canonical
  const canonical = $('link[rel="canonical"]').attr("href");
  add({
    id: "canonical",
    categoria: "SEO",
    titulo: "URL canônica",
    peso: 4,
    ...(canonical
      ? { status: "ok", detalhe: `Canonical definida: ${canonical}` }
      : {
          status: "aviso",
          detalhe: "Sem tag canonical.",
          dica: "Evita conteúdo duplicado quando a mesma página é acessível por várias URLs (com/sem www, com parâmetros etc.).",
        }),
  });

  // Viewport / mobile
  const viewport = $('meta[name="viewport"]').attr("content");
  add({
    id: "viewport",
    categoria: "SEO",
    titulo: "Mobile-friendly (viewport)",
    peso: 6,
    ...(viewport
      ? { status: "ok", detalhe: "Meta viewport presente." }
      : {
          status: "erro",
          detalhe: "Sem meta viewport — o site não se adapta a celular.",
          dica: "O Google indexa mobile-first. Adicione <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
        }),
  });

  // Meta robots noindex (mata a indexação inteira)
  const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  add({
    id: "noindex",
    categoria: "SEO",
    titulo: "Permissão de indexação",
    peso: 9,
    ...(metaRobots.includes("noindex")
      ? {
          status: "erro",
          detalhe: `Página marcada com noindex ("${metaRobots}") — o Google está proibido de indexá-la.`,
          dica: "Remova o noindex da meta robots. Enquanto ele existir, o site não aparece em NENHUMA busca.",
        }
      : { status: "ok", detalhe: "Página indexável (sem noindex)." }),
  });

  // Conteúdo misto (http dentro de https)
  const imgsHttp = $('img[src^="http://"]').length;
  if (finalUrl.protocol === "https:") {
    add({
      id: "mixed",
      categoria: "SEO",
      titulo: "Conteúdo misto (HTTP em página HTTPS)",
      peso: 3,
      ...(imgsHttp > 0
        ? {
            status: "aviso",
            detalhe: `${imgsHttp} imagem(ns) carregada(s) via HTTP inseguro.`,
            dica: "Navegadores bloqueiam ou marcam conteúdo misto — troque os src para https://.",
          }
        : { status: "ok", detalhe: "Todos os recursos em HTTPS." }),
    });
  }

  // Alt text
  const imgs = $("img");
  const semAlt = imgs.filter((_, el) => !$(el).attr("alt")?.trim()).length;
  add({
    id: "alt",
    categoria: "SEO",
    titulo: "Texto alternativo em imagens",
    peso: 4,
    ...(imgs.length === 0
      ? { status: "ok", detalhe: "Sem imagens na página." }
      : semAlt === 0
      ? { status: "ok", detalhe: `Todas as ${imgs.length} imagens têm alt.` }
      : semAlt / imgs.length > 0.5
      ? {
          status: "erro",
          detalhe: `${semAlt} de ${imgs.length} imagens sem alt.`,
          dica: "Alt text é acessibilidade + SEO de imagem. Descreva o conteúdo de cada imagem.",
        }
      : {
          status: "aviso",
          detalhe: `${semAlt} de ${imgs.length} imagens sem alt.`,
          dica: "Complete o alt das imagens restantes.",
        }),
  });

  // Idioma
  const lang = $("html").attr("lang");
  add({
    id: "lang",
    categoria: "SEO",
    titulo: "Idioma declarado",
    peso: 2,
    ...(lang
      ? { status: "ok", detalhe: `lang="${lang}".` }
      : {
          status: "aviso",
          detalhe: "Atributo lang ausente no <html>.",
          dica: "Declare o idioma (ex.: lang=\"pt-BR\") — ajuda buscadores e leitores de tela.",
        }),
  });

  // Open Graph
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  add({
    id: "og",
    categoria: "SEO",
    titulo: "Open Graph (compartilhamento)",
    peso: 3,
    ...(ogTitle && ogImage
      ? { status: "ok", detalhe: "og:title e og:image presentes." }
      : ogTitle || ogImage
      ? {
          status: "aviso",
          detalhe: "Open Graph incompleto (falta og:title ou og:image).",
          dica: "Sem OG completo, o link compartilhado no WhatsApp/Instagram aparece sem imagem e sem título.",
        }
      : {
          status: "aviso",
          detalhe: "Sem tags Open Graph.",
          dica: "Adicione og:title, og:description e og:image para o link ficar bonito ao ser compartilhado.",
        }),
  });

  // ---------- AEO ----------
  // Schema.org / JSON-LD
  const ldBlocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get();
  const ldTypes = new Set();
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block);
      const collect = (o) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(collect);
        if (o["@type"])
          (Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]).forEach((t) =>
            ldTypes.add(String(t))
          );
        Object.values(o).forEach(collect);
      };
      collect(parsed);
    } catch {}
  }
  add({
    id: "schema",
    categoria: "AEO",
    titulo: "Dados estruturados (schema.org)",
    peso: 7,
    ...(ldTypes.size > 0
      ? {
          status: "ok",
          detalhe: `JSON-LD presente: ${[...ldTypes].slice(0, 6).join(", ")}.`,
        }
      : {
          status: "erro",
          detalhe: "Nenhum dado estruturado (JSON-LD) encontrado.",
          dica: "Schema.org é como buscadores e IAs entendem o que o site É (negócio local, produto, artigo…). Comece com Organization/LocalBusiness.",
        }),
  });

  const hasFaqSchema = ldTypes.has("FAQPage");
  add({
    id: "faq-schema",
    categoria: "AEO",
    titulo: "FAQ schema",
    peso: 6,
    ...(hasFaqSchema
      ? { status: "ok", detalhe: "FAQPage schema presente — elegível a rich results de FAQ." }
      : {
          status: "aviso",
          detalhe: "Sem FAQ schema.",
          dica: "Perguntas e respostas marcadas com FAQPage são a porta de entrada para featured snippets e People Also Ask.",
        }),
  });

  // Headings em formato de pergunta
  const headings = $("h1,h2,h3")
    .map((_, el) => $(el).text().trim())
    .get();
  const perguntas = headings.filter((h) =>
    /\?|^(como|por que|porque|o que|qual|quais|quando|onde|quanto)\b/i.test(h)
  );
  add({
    id: "perguntas",
    categoria: "AEO",
    titulo: "Conteúdo em formato pergunta-resposta",
    peso: 6,
    ...(perguntas.length >= 2
      ? {
          status: "ok",
          detalhe: `${perguntas.length} títulos em formato de pergunta (ex.: “${perguntas[0].slice(0, 60)}”).`,
        }
      : perguntas.length === 1
      ? {
          status: "aviso",
          detalhe: "Apenas 1 título em formato de pergunta.",
          dica: "Answer engines respondem perguntas. Estruture seções como “Como funciona X?”, “Quanto custa Y?”.",
        }
      : {
          status: "erro",
          detalhe: "Nenhum título em formato de pergunta.",
          dica: "O site não responde diretamente às perguntas que clientes fazem no Google/ChatGPT — a maior oportunidade de AEO.",
        }),
  });

  // Listas e tabelas (conteúdo extraível)
  const listas = $("ul li, ol li").length;
  const tabelas = $("table").length;
  add({
    id: "extraivel",
    categoria: "AEO",
    titulo: "Conteúdo estruturado (listas/tabelas)",
    peso: 4,
    ...(listas >= 5 || tabelas >= 1
      ? { status: "ok", detalhe: `${listas} itens de lista, ${tabelas} tabelas.` }
      : {
          status: "aviso",
          detalhe: "Pouco conteúdo em listas ou tabelas.",
          dica: "Featured snippets adoram listas numeradas e tabelas — são fáceis de extrair e exibir como resposta.",
        }),
  });

  // ---------- GEO ----------
  // Volume de texto (citabilidade exige substância)
  const bodyText = $("body").clone().find("script,style,noscript").remove().end().text();
  const palavras = bodyText.split(/\s+/).filter(Boolean).length;
  add({
    id: "substancia",
    categoria: "GEO",
    titulo: "Substância de conteúdo",
    peso: 6,
    ...(palavras >= 600
      ? { status: "ok", detalhe: `~${palavras} palavras de conteúdo.` }
      : palavras >= 250
      ? {
          status: "aviso",
          detalhe: `~${palavras} palavras — pouco material citável.`,
          dica: "LLMs citam páginas com informação factual substantiva. Páginas rasas raramente são referenciadas.",
        }
      : {
          status: "erro",
          detalhe: `~${palavras} palavras — quase nada para uma IA citar.`,
          dica: "ChatGPT/Perplexity só citam quem tem conteúdo. Este é o gap número 1 para GEO — e exatamente o que um blog resolve.",
        }),
  });

  // Sinais E-E-A-T aproximados: autor, sobre, contato
  const links = $("a[href]")
    .map((_, el) => ($(el).attr("href") || "").toLowerCase())
    .get();
  const temSobre = links.some((h) => /sobre|about|quem-somos/.test(h));
  const temContato = links.some((h) => /contato|contact|fale-conosco/.test(h));
  add({
    id: "eeat",
    categoria: "GEO",
    titulo: "Sinais de confiança (E-E-A-T)",
    peso: 5,
    ...(temSobre && temContato
      ? { status: "ok", detalhe: "Páginas “sobre” e “contato” linkadas." }
      : {
          status: "aviso",
          detalhe: `Faltam sinais de identidade: ${[
            !temSobre && "página “sobre”",
            !temContato && "página de contato",
          ]
            .filter(Boolean)
            .join(" e ")}.`,
          dica: "IAs (e o Google) priorizam fontes identificáveis: quem escreve, qual empresa, como contatar.",
        }),
  });

  // Blog / conteúdo editorial — o coração do que o Citavel vende
  const temBlog = links.some((h) =>
    /\/(blog|artigos?|noticias?|conteudos?|dicas|materias)(\/|$|\?)/.test(h)
  );
  add({
    id: "blog",
    categoria: "GEO",
    titulo: "Blog / conteúdo editorial",
    peso: 8,
    ...(temBlog
      ? { status: "ok", detalhe: "Site tem seção de blog/conteúdo linkada." }
      : {
          status: "erro",
          detalhe: "Nenhum blog ou seção de conteúdo encontrada.",
          dica: "Sem conteúdo editorial, não existe material para o Google rankear nem para o ChatGPT citar. É o gap mais caro do site — e o mais fácil de resolver com produção contínua.",
        }),
  });

  // Página de FAQ
  const temFaqPage =
    links.some((h) => /faq|perguntas-frequentes|duvidas/.test(h)) || hasFaqSchema;
  add({
    id: "faq-page",
    categoria: "AEO",
    titulo: "Página de perguntas frequentes",
    peso: 4,
    ...(temFaqPage
      ? { status: "ok", detalhe: "Página/seção de FAQ encontrada." }
      : {
          status: "aviso",
          detalhe: "Sem página de perguntas frequentes.",
          dica: "Uma página de FAQ bem marcada é a forma mais barata de aparecer em People Also Ask e em respostas de IA.",
        }),
  });

  // Datas / frescor
  const temData =
    $("time[datetime]").length > 0 ||
    /(?:atualizado|publicado)\s+em/i.test(bodyText) ||
    ldTypes.has("Article") ||
    ldTypes.has("BlogPosting");
  add({
    id: "frescor",
    categoria: "GEO",
    titulo: "Sinais de atualidade",
    peso: 4,
    ...(temData
      ? { status: "ok", detalhe: "Conteúdo com datas/marcação de artigo." }
      : {
          status: "aviso",
          detalhe: "Nenhum sinal de data de publicação/atualização.",
          dica: "LLMs preferem citar conteúdo comprovadamente recente. Use <time> e schema Article com datePublished.",
        }),
  });

  // llms.txt — padrão emergente de GEO ("robots.txt das IAs")
  let temLlms = false;
  try {
    const r = await fetchWithTimeout(`${finalUrl.origin}/llms.txt`, 5000);
    if (r.ok) {
      const corpo = await r.text();
      temLlms = corpo.length > 20 && !/^\s*</.test(corpo);
    }
  } catch {}
  add({
    id: "llms",
    categoria: "GEO",
    titulo: "llms.txt",
    peso: 4,
    ...(temLlms
      ? { status: "ok", detalhe: "llms.txt presente — o site se apresenta às IAs." }
      : {
          status: "aviso",
          detalhe: "Sem llms.txt.",
          dica: "O llms.txt é o novo padrão para resumir seu site aos LLMs em texto puro. Custa 10 minutos e coloca você à frente de 99% dos concorrentes em GEO.",
        }),
  });

  // Peso da página (proxy de renderização p/ crawlers de IA)
  add({
    id: "peso",
    categoria: "GEO",
    titulo: "Peso do HTML",
    peso: 3,
    ...(htmlKb < 300
      ? { status: "ok", detalhe: `HTML com ${htmlKb} KB.` }
      : {
          status: "aviso",
          detalhe: `HTML pesado: ${htmlKb} KB.`,
          dica: "Crawlers de IA têm orçamento de leitura curto — HTML enxuto com conteúdo no fonte (não só via JS) é mais citável.",
        }),
  });

  // Conteúdo depende de JS?
  add({
    id: "js-only",
    categoria: "GEO",
    titulo: "Conteúdo no HTML-fonte",
    peso: 5,
    ...(palavras < 100 && $("script[src]").length > 3
      ? {
          status: "erro",
          detalhe: "Página quase vazia no HTML-fonte, com muitos scripts — conteúdo provavelmente só renderiza via JavaScript.",
          dica: "Muitos crawlers de IA não executam JS. Use SSR/pré-renderização para o conteúdo existir no fonte.",
        }
      : { status: "ok", detalhe: "Conteúdo presente direto no HTML-fonte." }),
  });

  // Copyright desatualizado (sinal de site abandonado)
  const anoAtual = new Date().getFullYear();
  const anosCopyright = [...bodyText.matchAll(/(?:©|copyright)\s*(20\d{2})/gi)].map(
    (m) => parseInt(m[1], 10)
  );
  const anoMax = anosCopyright.length ? Math.max(...anosCopyright) : null;
  if (anoMax) {
    add({
      id: "copyright",
      categoria: "GEO",
      titulo: "Sinal de site ativo",
      peso: 2,
      ...(anoMax >= anoAtual - 1
        ? { status: "ok", detalhe: `Copyright ${anoMax} — site aparenta manutenção.` }
        : {
            status: "aviso",
            detalhe: `Copyright parado em ${anoMax}.`,
            dica: "Rodapé com ano antigo sinaliza abandono para visitantes, Google e IAs.",
          }),
    });
  }

  // Perguntas comerciais que todo cliente faz — o site responde?
  const catalogoComercial = [
    { id: "preco", q: "Quanto custa? (preços)", re: /quanto custa|pre[çc]os?\b|valores\b|a partir de r\$|r\$\s?\d/i },
    { id: "como-funciona", q: "Como funciona?", re: /como funciona/i },
    { id: "horario", q: "Horário de atendimento", re: /hor[áa]rio de (funcionamento|atendimento)|seg(unda)?[\s-]*[aà][\s-]*sex/i },
    { id: "endereco", q: "Onde fica? (endereço)", re: /endere[çc]o|onde (fica|estamos)|\brua\s+[a-z]|\bavenida\s+[a-z]|\bav\.\s/i },
    { id: "pagamento", q: "Formas de pagamento", re: /formas? de pagamento|\bpix\b|cart[ãa]o de cr[ée]dito|boleto|parcel(e|amos|amento)/i },
    { id: "garantia", q: "Garantia / trocas", re: /garantia|pol[íi]tica de troca|devolu[çc][ãa]o|reembolso/i },
  ];
  const textoBusca = bodyText.toLowerCase();
  const naoRespondidas = catalogoComercial.filter((c) => !c.re.test(textoBusca));
  add({
    id: "comercial",
    categoria: "AEO",
    titulo: "Respostas às perguntas de compra",
    peso: 6,
    ...(naoRespondidas.length <= 1
      ? { status: "ok", detalhe: "O site responde às principais perguntas comerciais." }
      : naoRespondidas.length <= 3
      ? {
          status: "aviso",
          detalhe: `${naoRespondidas.length} perguntas básicas de compra sem resposta: ${naoRespondidas.map((c) => c.q).join("; ")}.`,
          dica: "Cada pergunta sem resposta é um cliente que fecha a aba — e uma busca em que você não aparece.",
        }
      : {
          status: "erro",
          detalhe: `O site não responde ${naoRespondidas.length} das ${catalogoComercial.length} perguntas que todo cliente faz: ${naoRespondidas.map((c) => c.q).join("; ")}.`,
          dica: "Quando o cliente pergunta isso ao Google ou ao ChatGPT, quem responde é o concorrente.",
        }),
  });

  // Páginas internas: rastreia até 3 além da home (profundidade prevista no plano)
  const internas = [
    ...new Set(
      $("a[href]")
        .map((_, el) => {
          try {
            const u = new URL($(el).attr("href"), finalUrl.href);
            if (u.origin !== finalUrl.origin) return null;
            if (u.pathname === finalUrl.pathname || u.pathname === "/") return null;
            if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|css|js|xml)$/i.test(u.pathname)) return null;
            return u.origin + u.pathname;
          } catch {
            return null;
          }
        })
        .get()
        .filter(Boolean)
    ),
  ].slice(0, 3);

  if (internas.length > 0) {
    const resultados = await Promise.allSettled(
      internas.map(async (u) => {
        const r = await fetchWithTimeout(u, 7000);
        if (!r.ok) return { u, problemas: [`responde HTTP ${r.status}`] };
        const $$ = cheerio.load(await r.text());
        const problemas = [];
        const t = $$("head > title").text().trim();
        if (!t) problemas.push("sem <title>");
        else if (t === title) problemas.push("title duplicado da home");
        if (!$$('meta[name="description"]').attr("content")?.trim())
          problemas.push("sem meta description");
        if ($$("h1").length === 0) problemas.push("sem H1");
        const pal = $$("body").clone().find("script,style,noscript").remove().end()
          .text().split(/\s+/).filter(Boolean).length;
        if (pal < 200) problemas.push(`conteúdo raso (~${pal} palavras)`);
        return { u, problemas };
      })
    );
    const analisadas = resultados
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    const comProblema = analisadas.filter((p) => p.problemas.length > 0);
    if (analisadas.length > 0) {
      add({
        id: "internas",
        categoria: "SEO",
        titulo: `Páginas internas (${analisadas.length} analisadas)`,
        peso: 6,
        ...(comProblema.length === 0
          ? { status: "ok", detalhe: "Páginas internas com on-page em ordem." }
          : comProblema.length < analisadas.length
          ? {
              status: "aviso",
              detalhe: comProblema
                .map((p) => `${new URL(p.u).pathname}: ${p.problemas.join(", ")}`)
                .join(" · "),
              dica: "Cada página interna compete sozinha no Google — todas precisam de title, meta e conteúdo próprios.",
            }
          : {
              status: "erro",
              detalhe: comProblema
                .map((p) => `${new URL(p.u).pathname}: ${p.problemas.join(", ")}`)
                .join(" · "),
              dica: "Todas as páginas internas analisadas têm problemas de on-page — o site inteiro está competindo abaixo do potencial.",
            }),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pauta automática (versão determinística da Camada 2):
  // gaps de conteúdo que viram fila de posts na fase paga
  // ---------------------------------------------------------------------------
  const gaps = [];
  if (!temBlog)
    gaps.push({
      id: "blog",
      titulo: "Criar a seção de blog — hoje não existe nenhum conteúdo editorial para o Google rankear ou o ChatGPT citar",
    });
  for (const c of naoRespondidas)
    gaps.push({
      id: `comercial:${c.id}`,
      pergunta: c.q,
      titulo: `Post respondendo "${c.q}" — pergunta que clientes fazem e o site não responde`,
    });
  if (!temFaqPage)
    gaps.push({
      id: "faq",
      titulo: "Página de perguntas frequentes com FAQ schema — porta de entrada para featured snippets",
    });
  if (perguntas.length === 0)
    gaps.push({
      id: "perguntas",
      titulo: "Reestruturar títulos em formato de pergunta — como buscadores e IAs indexam respostas",
    });
  if (palavras < 600)
    gaps.push({
      id: "substancia",
      titulo: "Aprofundar o conteúdo institucional — páginas rasas não são citadas por IAs",
    });

  // ---------------------------------------------------------------------------
  // Nota 0-100 ponderada
  // ---------------------------------------------------------------------------
  // Aviso vale só 30% do peso; cada problema crítico também põe um teto na
  // nota final — um site com 5 erros graves não pode parecer "nota 70".
  const credito = (c) => (c.status === "ok" ? 1 : c.status === "aviso" ? 0.3 : 0);
  const pesoTotal = checks.reduce((s, c) => s + c.peso, 0);
  const pontos = checks.reduce((s, c) => s + c.peso * credito(c), 0);
  const nErros = checks.filter((c) => c.status === "erro").length;
  const teto = Math.max(20, 92 - nErros * 8);
  const nota = Math.min(Math.round((pontos / pesoTotal) * 100), teto);

  const porCategoria = {};
  for (const cat of ["SEO", "AEO", "GEO"]) {
    const cs = checks.filter((c) => c.categoria === cat);
    const pt = cs.reduce((s, c) => s + c.peso, 0);
    const pp = cs.reduce((s, c) => s + c.peso * credito(c), 0);
    const errosCat = cs.filter((c) => c.status === "erro").length;
    porCategoria[cat] = Math.min(
      Math.round((pp / pt) * 100),
      Math.max(15, 95 - errosCat * 12)
    );
  }

  // Contexto do negócio — insumo para a geração de posts (Fase paga / Fase A)
  const GENERICOS = /^(home|in[íi]cio|bem[- ]?vindo|p[áa]gina inicial|welcome|untitled|site|blog|index)$/i;
  const candidatosNome = [
    $('meta[property="og:site_name"]').attr("content")?.trim(),
    ...(title ? title.split(/\s*[|\-–—]\s*/).map((s) => s.trim()) : []),
  ].filter((n) => n && n.length >= 2 && !GENERICOS.test(n));
  const dominioLimpo = finalUrl.hostname.replace(/^www\./, "");
  const nomeNegocio =
    candidatosNome[0] ||
    dominioLimpo.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  // Dados de contato detectados automaticamente — pré-preenchem o perfil
  const htmlBruto = html;
  const wa = htmlBruto.match(/wa\.me\/(\d{10,14})/)?.[1] || htmlBruto.match(/api\.whatsapp\.com\/send\?phone=(\d{10,14})/)?.[1];
  const tel =
    (wa ? `+${wa}` : null) ||
    htmlBruto.match(/href="tel:([+\d\s()-]{8,20})"/)?.[1]?.trim() ||
    bodyText.match(/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/)?.[0] ||
    "";
  const email =
    htmlBruto.match(/href="mailto:([^"?]+)/)?.[1] ||
    bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ||
    "";
  const instagram = htmlBruto.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/)?.[1] || "";

  const contexto = {
    nome: nomeNegocio,
    dominio: dominioLimpo,
    descricao: metaDesc || "",
    resumoTexto: bodyText.replace(/\s+/g, " ").trim().slice(0, 4000),
    detectado: {
      telefone: tel,
      email,
      instagram: instagram && !/^(p|reel|explore|stories)$/.test(instagram) ? "@" + instagram : "",
    },
  };

  return {
    url: finalUrl.href,
    titulo: title || finalUrl.hostname,
    nota,
    porCategoria,
    gaps,
    contexto,
    ttfbMs,
    checks: checks.sort(
      (a, b) =>
        ({ erro: 0, aviso: 1, ok: 2 }[a.status] - { erro: 0, aviso: 1, ok: 2 }[b.status]) ||
        b.peso - a.peso
    ),
    geradoEm: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cache dos últimos diagnósticos (30 min) — alimenta a geração de posts
const diagnosticos = new Map();
const CACHE_MS = 30 * 60 * 1000;
function chaveUrl(u) {
  return u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

app.post("/api/diagnostico", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (rateLimited(ip)) {
    return res.status(429).json({ erro: "Limite de análises atingido. Tente de novo em alguns minutos." });
  }
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ erro: "Informe uma URL." });
  }
  try {
    const resultado = await diagnose(url.trim());
    diagnosticos.set(chaveUrl(url), { resultado, em: Date.now() });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// Fase A (seção 3.1 do plano): gera o post completo de uma pauta do diagnóstico
app.post("/api/post", async (req, res) => {
  const { url, gapId } = req.body || {};
  if (!url || !gapId) {
    return res.status(400).json({ erro: "Informe url e gapId." });
  }
  try {
    let entrada = diagnosticos.get(chaveUrl(url));
    if (!entrada || Date.now() - entrada.em > CACHE_MS) {
      const resultado = await diagnose(url.trim());
      entrada = { resultado, em: Date.now() };
      diagnosticos.set(chaveUrl(url), entrada);
    }
    const { resultado } = entrada;
    const gap = resultado.gaps.find((g) => g.id === gapId);
    if (!gap) {
      return res.status(404).json({ erro: "Pauta não encontrada para este site." });
    }
    const post = await gerarPost(resultado.contexto, gap);
    res.json({ ...post, site: resultado.contexto.nome, url: resultado.url, gap });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// ---------------------------------------------------------------------------
// Kit de Correção — soluções técnicas prontas para colar (meta, schema,
// robots.txt, llms.txt, FAQ schema)
// ---------------------------------------------------------------------------
app.get("/api/kit", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ erro: "Informe ?url=" });
  try {
    let entrada = diagnosticos.get(chaveUrl(url));
    if (!entrada || Date.now() - entrada.em > CACHE_MS) {
      const resultado = await diagnose(String(url).trim());
      entrada = { resultado, em: Date.now() };
      diagnosticos.set(chaveUrl(url), entrada);
    }
    res.json(gerarKit(entrada.resultado));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// ---------------------------------------------------------------------------
// Clientes + automação ponta a ponta (seção 4 do plano)
// ---------------------------------------------------------------------------
async function diagnosticoDe(url) {
  let entrada = diagnosticos.get(chaveUrl(url));
  if (!entrada || Date.now() - entrada.em > CACHE_MS) {
    const resultado = await diagnose(url.trim());
    entrada = { resultado, em: Date.now() };
    diagnosticos.set(chaveUrl(url), entrada);
  }
  return entrada.resultado;
}

function clientePublico(c) {
  // nunca devolve a senha do WordPress ao front
  const { entrega, ...resto } = c;
  return {
    ...resto,
    entrega: {
      ...entrega,
      wp: entrega?.wp ? { url: entrega.wp.url, usuario: entrega.wp.usuario, temSenha: !!entrega.wp.senha } : null,
    },
  };
}

app.get("/api/clientes", (_req, res) => {
  res.json(listarClientes().map(clientePublico));
});

app.post("/api/clientes", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ erro: "Informe a URL do site." });
  try {
    const resultado = await diagnosticoDe(url);
    const existente = listarClientes().find((c) => chaveUrl(c.url) === chaveUrl(resultado.url));
    if (existente) return res.json(clientePublico(existente));
    const cliente = criarCliente({
      id: crypto.randomUUID().slice(0, 8),
      url: resultado.url,
      nome: resultado.contexto.nome,
      contexto: resultado.contexto,
      nota: resultado.nota,
      criadoEm: new Date().toISOString(),
      // fila de pauta nasce direto do diagnóstico (seção 4.2)
      pauta: resultado.gaps.map((g) => ({ ...g, usado: false })),
      posts: [],
      // Perfil do negócio — respostas do dono que preenchem os posts.
      // Nasce pré-preenchido com o que o diagnóstico detectou no site.
      perfil: {
        oQueFaz: resultado.contexto.descricao || "",
        publico: "",
        diferenciais: "",
        precoBase: "",
        pagamento: "",
        horario: "",
        endereco: "",
        whatsapp: resultado.contexto.detectado?.telefone || "",
        email: resultado.contexto.detectado?.email || "",
        instagram: resultado.contexto.detectado?.instagram || "",
        garantia: "",
        comoComecar: "",
      },
      entrega: { modo: "hospedado", wp: null },
      tema: { corPrimaria: "#6c8cff", corFundo: "#ffffff", corTexto: "#1c2333" },
      agenda: { autoPublicar: false, intervaloDias: 3, proximaEm: null },
    });
    res.json(clientePublico(cliente));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

app.get("/api/clientes/:id", (req, res) => {
  const c = obterCliente(req.params.id);
  if (!c) return res.status(404).json({ erro: "Cliente não encontrado." });
  res.json(clientePublico(c));
});

app.patch("/api/clientes/:id", (req, res) => {
  const c = obterCliente(req.params.id);
  if (!c) return res.status(404).json({ erro: "Cliente não encontrado." });
  const { entrega, tema, agenda, perfil } = req.body || {};
  if (perfil) c.perfil = { ...c.perfil, ...perfil };
  if (tema) c.tema = { ...c.tema, ...tema };
  if (agenda) {
    c.agenda = { ...c.agenda, ...agenda };
    if (c.agenda.autoPublicar && !c.agenda.proximaEm) {
      c.agenda.proximaEm = new Date(Date.now() + c.agenda.intervaloDias * 86400000).toISOString();
    }
    if (!c.agenda.autoPublicar) c.agenda.proximaEm = null;
  }
  if (entrega) {
    c.entrega.modo = entrega.modo || c.entrega.modo;
    if (entrega.wp) {
      c.entrega.wp = {
        url: entrega.wp.url || c.entrega.wp?.url,
        usuario: entrega.wp.usuario || c.entrega.wp?.usuario,
        // só sobrescreve a senha se veio uma nova
        senha: entrega.wp.senha || c.entrega.wp?.senha,
      };
    }
  }
  persistir();
  res.json(clientePublico(c));
});

app.post("/api/wp/testar", async (req, res) => {
  try {
    res.json(await testarWordpress(req.body || {}));
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Gera o post da próxima pauta (ou de uma pauta específica) → fila de revisão
app.post("/api/clientes/:id/gerar", async (req, res) => {
  const c = obterCliente(req.params.id);
  if (!c) return res.status(404).json({ erro: "Cliente não encontrado." });
  const { gapId } = req.body || {};
  const gap = gapId
    ? c.pauta.find((g) => g.id === gapId)
    : c.pauta.find((g) => !g.usado);
  if (!gap) return res.status(400).json({ erro: "Nenhuma pauta disponível na fila." });
  try {
    const post = await gerarPost(c.contexto, gap, c.perfil);
    const registro = {
      id: crypto.randomUUID().slice(0, 8),
      gapId: gap.id,
      status: "needs_review", // mesma fila de revisão do hub (seção 4.4)
      criadoEm: new Date().toISOString(),
      publicadoEm: null,
      publishAt: null,
      canal: null,
      link: null,
      ...post,
    };
    gap.usado = true;
    c.posts.push(registro);
    persistir();
    res.json(registro);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post("/api/clientes/:id/posts/:postId/:acao", async (req, res) => {
  const c = obterCliente(req.params.id);
  const post = c?.posts.find((p) => p.id === req.params.postId);
  if (!post) return res.status(404).json({ erro: "Post não encontrado." });
  const { acao } = req.params;
  try {
    if (acao === "aprovar") {
      post.status = "aprovado";
      post.publishAt = req.body?.publishAt || null; // agendamento (seção 4.6)
    } else if (acao === "rejeitar") {
      post.status = "rejeitado";
      const gap = c.pauta.find((g) => g.id === post.gapId);
      if (gap) gap.usado = false; // pauta volta pra fila
    } else if (acao === "publicar") {
      const resu = await publicar(c, post);
      post.status = "publicado";
      post.publicadoEm = new Date().toISOString();
      post.canal = resu.canal;
      post.link = resu.link;
    } else {
      return res.status(400).json({ erro: "Ação inválida." });
    }
    persistir();
    res.json(post);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get("/api/clientes/:id/proxy-snippet", (req, res) => {
  const c = obterCliente(req.params.id);
  if (!c) return res.status(404).json({ erro: "Cliente não encontrado." });
  const origem = `${req.protocol}://${req.get("host")}`;
  res.json({ snippet: snippetProxy(c, origem) });
});

// ---------------------------------------------------------------------------
// Blog hospedado (Fase C/3.4) — posts publicados servidos com o tema do cliente
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paginaBlog(c, tituloPagina, corpo, meta = "") {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tituloPagina)}</title>
${meta}
<style>
  :root { --p: ${c.tema.corPrimaria}; --bg: ${c.tema.corFundo}; --t: ${c.tema.corTexto}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background: var(--bg); color: var(--t); font-family: Georgia, "Times New Roman", serif; line-height: 1.7; }
  header { border-bottom: 3px solid var(--p); padding: 22px 0; margin-bottom: 36px; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 22px; }
  header a { color: var(--t); text-decoration: none; font-size: 1.3rem; font-weight: 700; font-family: system-ui, sans-serif; }
  h1 { font-size: 2rem; line-height: 1.25; margin-bottom: 20px; }
  h2 { font-size: 1.4rem; margin: 30px 0 10px; color: var(--p); }
  h3 { font-size: 1.1rem; margin: 22px 0 8px; }
  p { margin-bottom: 14px; }
  ul { margin: 0 0 16px 24px; }
  li { margin-bottom: 6px; }
  article { padding-bottom: 60px; }
  .lista-post { display: block; padding: 18px 0; border-bottom: 1px solid rgba(128,128,128,.25); text-decoration: none; color: var(--t); }
  .lista-post b { font-size: 1.15rem; }
  .lista-post span { display: block; opacity: .7; font-size: .92rem; margin-top: 4px; }
  footer { padding: 30px 0 50px; opacity: .55; font-size: .8rem; font-family: system-ui, sans-serif; }
</style>
</head>
<body>
<header><div class="wrap"><a href="/b/${c.id}">${esc(c.nome)}</a></div></header>
<div class="wrap">${corpo}</div>
<footer><div class="wrap">Blog de ${esc(c.nome)} · conteúdo por Citavel</div></footer>
</body>
</html>`;
}

app.get("/b/:id", (req, res) => {
  const c = obterCliente(req.params.id);
  if (!c) return res.status(404).send("Blog não encontrado");
  const publicados = c.posts.filter((p) => p.status === "publicado");
  const corpo =
    `<h1>Blog</h1>` +
    (publicados.length
      ? publicados
          .map(
            (p) =>
              `<a class="lista-post" href="/b/${c.id}/${p.slug}"><b>${esc(p.titulo)}</b><span>${esc(p.metaDescription)}</span></a>`
          )
          .join("")
      : `<p>Os primeiros posts chegam em breve.</p>`);
  res.send(paginaBlog(c, `Blog — ${c.nome}`, corpo));
});

app.get("/b/:id/:slug", (req, res) => {
  const c = obterCliente(req.params.id);
  const post = c?.posts.find((p) => p.slug === req.params.slug && p.status === "publicado");
  if (!post) return res.status(404).send("Post não encontrado");
  const meta = `<meta name="description" content="${esc(post.metaDescription)}">
<script type="application/ld+json">${JSON.stringify(post.faqSchema)}</script>`;
  const corpo = post.htmlCompleto.replace(/<script[\s\S]*?<\/script>/g, "");
  res.send(paginaBlog(c, post.titulo, corpo, meta));
});

// ---------------------------------------------------------------------------
// Scheduler (seções 4.3 e 4.6) — roda a cada minuto:
//  1. publica posts aprovados cujo publishAt chegou
//  2. no piloto automático: gera + publica o próximo post da pauta na cadência
// ---------------------------------------------------------------------------
setInterval(async () => {
  const agora = Date.now();
  for (const c of listarClientes()) {
    // 1. agendados
    for (const p of c.posts) {
      if (p.status === "aprovado" && p.publishAt && new Date(p.publishAt).getTime() <= agora) {
        try {
          const resu = await publicar(c, p);
          p.status = "publicado";
          p.publicadoEm = new Date().toISOString();
          p.canal = resu.canal;
          p.link = resu.link;
          persistir();
          console.log(`[scheduler] publicado agendado: ${c.nome} — ${p.titulo}`);
        } catch (e) {
          console.error(`[scheduler] falha ao publicar ${p.id}: ${e.message}`);
        }
      }
    }
    // 2. piloto automático
    const a = c.agenda;
    if (a?.autoPublicar && a.proximaEm && new Date(a.proximaEm).getTime() <= agora) {
      const gap = c.pauta.find((g) => !g.usado);
      if (!gap) {
        a.autoPublicar = false;
        a.proximaEm = null;
        persistir();
        continue;
      }
      try {
        const post = await gerarPost(c.contexto, gap, c.perfil);
        const registro = {
          id: crypto.randomUUID().slice(0, 8),
          gapId: gap.id,
          status: "publicado",
          criadoEm: new Date().toISOString(),
          publicadoEm: new Date().toISOString(),
          publishAt: null,
          canal: null,
          link: null,
          ...post,
        };
        const resu = await publicar(c, registro);
        registro.canal = resu.canal;
        registro.link = resu.link;
        gap.usado = true;
        c.posts.push(registro);
        a.proximaEm = new Date(agora + a.intervaloDias * 86400000).toISOString();
        persistir();
        console.log(`[scheduler] piloto automático: ${c.nome} — ${registro.titulo}`);
      } catch (e) {
        console.error(`[scheduler] piloto automático falhou (${c.nome}): ${e.message}`);
      }
    }
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Citavel rodando em http://localhost:${PORT}`);
});
