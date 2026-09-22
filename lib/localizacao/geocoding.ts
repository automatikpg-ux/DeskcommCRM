/**
 * Geocodificação de CEP — endereço via ViaCEP, coordenadas via Nominatim
 * (OpenStreetMap). As duas são gratuitas e sem chave de API.
 *
 * ⚠️ NÃO CHAME ISTO A CADA BUSCA DE DISTÂNCIA para uma unidade da organização.
 * O Nominatim tem limite de uso (~1 req/s, política de uso comedido) e o CEP
 * de uma unidade não muda — por isso o resultado é gravado uma vez em
 * `crm_locations.lat/lng` (ver `lib/localizacao/unidades.ts`) e reaproveitado
 * dali em diante. Só o CEP de QUEM PERGUNTA muda a cada turno, e para esse não
 * tem como fugir de geocodificar sob demanda.
 */

const USER_AGENT = "DeskcommCRM-GeoAgent/1.0 (+https://github.com/automatikpg-ux/DeskcommCRM)";

export interface CoordenadasCep {
  lat: number;
  lng: number;
  enderecoResolvido: string;
}

interface ViaCepResposta {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

/** Só dígitos, 8 caracteres — o formato que as duas APIs esperam. `null` se não bater. */
export function normalizarCep(cepBruto: string): string | null {
  const digitos = cepBruto.replace(/\D/g, "");
  return digitos.length === 8 ? digitos : null;
}

async function buscaEnderecoPorCep(cep: string): Promise<ViaCepResposta | null> {
  const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!resp.ok) return null;
  const dados = (await resp.json()) as ViaCepResposta;
  if (dados.erro) return null;
  return dados;
}

async function buscaCoordenadasPorEndereco(endereco: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`;
  const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!resp.ok) return null;
  const dados = (await resp.json()) as Array<{ lat: string; lon: string }>;
  const primeiro = dados[0];
  if (!primeiro) return null;
  return { lat: Number(primeiro.lat), lng: Number(primeiro.lon) };
}

/**
 * CEP -> coordenadas. `null` quando o CEP não existe ou não geocodifica —
 * nunca lança, porque "não achei" é resposta de negócio, não falha de
 * infraestrutura (mesma doutrina de `lib/mcp/tools/retencao.ts`).
 *
 * `logradouroCompleto` é opcional (ex.: "Rua Luiz Amaro Costa, 528") e, quando
 * informado, entra na consulta ao Nominatim NO LUGAR do logradouro que o
 * ViaCEP devolve, buscando a precisão do número da casa em vez de só a rua.
 * O OpenStreetMap tem cobertura desigual de número de imóvel no Brasil —
 * quando a busca por número não acha nada, cai pro logradouro (sem número)
 * que o CEP já garante, em vez de devolver "não achei" por uma precisão a
 * mais que o geocoder gratuito não tinha como entregar.
 */
export async function geocodificarCep(
  cepBruto: string,
  logradouroCompleto?: string,
): Promise<CoordenadasCep | null> {
  const cep = normalizarCep(cepBruto);
  if (!cep) return null;

  const endereco = await buscaEnderecoPorCep(cep);
  if (!endereco) return null;

  const enderecoBase = [endereco.logradouro, endereco.bairro, endereco.localidade, endereco.uf]
    .filter(Boolean)
    .join(", ");
  if (!enderecoBase && !logradouroCompleto) return null;

  const cidadeUf = [endereco.localidade, endereco.uf].filter(Boolean).join(", ");

  if (logradouroCompleto) {
    const comNumero = await buscaCoordenadasPorEndereco(`${logradouroCompleto}, ${cidadeUf}, Brazil`);
    if (comNumero) return { ...comNumero, enderecoResolvido: `${logradouroCompleto}, ${cidadeUf}` };
  }

  if (!enderecoBase) return null;
  const semNumero = await buscaCoordenadasPorEndereco(`${enderecoBase}, Brazil`);
  if (!semNumero) return null;
  return { ...semNumero, enderecoResolvido: enderecoBase };
}

/** Distância em km entre duas coordenadas — haversine, raio da Terra 6371km. */
export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const senoLat = Math.sin(dLat / 2);
  const senoLng = Math.sin(dLng / 2);
  const h =
    senoLat * senoLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * senoLng * senoLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}
