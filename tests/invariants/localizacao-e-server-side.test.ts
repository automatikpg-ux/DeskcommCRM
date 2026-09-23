/**
 * `crm_locations` É SERVER-SIDE ONLY.
 *
 * Irmã declarada de `instagram-credenciais-e-server-side.test.ts` e de
 * `credencial-de-anuncios-e-server-side.test.ts` (o molde). A tabela guarda as
 * unidades físicas da organização — nome, CEP, endereço e coordenadas — e quem
 * a lê hoje é só o servidor: a ferramenta `crm_find_nearest_location` e o
 * script de cadastro, os dois com o admin client filtrando `organization_id` à
 * mão. Nenhuma tela lê isto pelo client de sessão; quando uma tela de
 * "Unidades" existir, a policy de tenant entra numa migration própria, junto
 * com ela (ver o cabeçalho da migration 0255).
 *
 * Não guarda segredo, então não há o bloco "gravado cifrado" do molde. O que
 * este arquivo prova é o desenho deny-all: sem ele, um `grant` que voltasse
 * por um `ALTER DEFAULT PRIVILEGES` qualquer serviria pelo PostgREST o
 * endereço de cada unidade de toda organização da instalação.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { motivoDoErro, sql } from "./psql-transporte";

const TABELA = "crm_locations";

function erroSob(papel: string, comando: string): string | null {
  try {
    sql(`set role ${papel};\n${comando};\nreset role;`);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

function esperaBarrado(papel: string, comando: string): void {
  const erro = erroSob(papel, comando);
  expect(erro, `\`${papel}\` executou "${comando}" SEM erro — a tabela está exposta`).not.toBeNull();
  expect(erro).toContain("permission denied");
}

function privilegiosDe(papel: string): string {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = '${TABELA}'
       and grantee = '${papel}';
  `).trim();
}

describe("a lista do `rls-isolation` e esta não se sobrepõem", () => {
  it("`crm_locations` NÃO está em `TABLES` do rls-isolation — e não pode entrar", () => {
    const fonte = readFileSync(join(__dirname, "rls-isolation.test.ts"), "utf8");
    const lista = /export const TABLES = \[([\s\S]*?)\] as const;/.exec(fonte);
    expect(lista, "não achei `export const TABLES` no rls-isolation — a sonda cegou").not.toBeNull();

    const naLista = (lista?.[1] ?? "")
      .split("\n")
      .map((l) => /^\s*"([a-z_]+)",/.exec(l)?.[1])
      .filter((v): v is string => Boolean(v));
    expect(naLista.length, "extraí zero nomes da lista — a sonda cegou").toBeGreaterThan(5);

    expect(
      naLista.includes(TABELA),
      "`crm_locations` entrou em TABLES do rls-isolation. Ela é deny-all (RLS ligada, " +
        "zero policies, grants revogados): lá o caso vai falhar com `permission denied`. " +
        "Se uma tela passou a ler a tabela, a policy de tenant e a mudança deste arquivo " +
        "entram juntas, numa migration própria.",
    ).toBe(false);
  });
});

describe("o PostgREST não serve `crm_locations`", () => {
  it("a tabela EXISTE no baseline — controle positivo da sonda", () => {
    const existe = sql(`
      select count(*) from information_schema.tables
       where table_schema = 'public' and table_name = '${TABELA}';
    `).trim();
    expect(existe, "`crm_locations` não está no baseline — o kit self-host não a cria").toBe("1");
  });

  it("`anon` não tem privilégio NENHUM", () => {
    expect(privilegiosDe("anon")).toBe("NENHUM");
  });

  it("`authenticated` também não tem — nenhuma tela lê isto pelo client de sessão", () => {
    expect(privilegiosDe("authenticated")).toBe("NENHUM");
  });

  it("`service_role` CONTINUA com privilégio — controle positivo do papel que usa", () => {
    const privilegios = privilegiosDe("service_role");
    expect(privilegios).toContain("SELECT");
    expect(privilegios).toContain("INSERT");
    expect(privilegios).toContain("UPDATE");
  });

  it("`anon` é BARRADO ao ler — permission denied, não zero linhas", () => {
    esperaBarrado("anon", `select organization_id from public.${TABELA}`);
  });

  it("`authenticated` é BARRADO ao ler", () => {
    esperaBarrado("authenticated", `select organization_id from public.${TABELA}`);
  });

  it("a RLS está LIGADA — o segundo degrau, para o dia em que o grant voltar", () => {
    const ligada = sql(`
      select relrowsecurity from pg_class where oid = 'public.${TABELA}'::regclass;
    `).trim();
    expect(ligada, "RLS desligada: o revoke vira a única defesa").toBe("t");
  });

  it("não há policy nenhuma — servir esta tabela ainda não é a intenção", () => {
    const quantas = sql(`
      select count(*) from pg_policies
       where schemaname = 'public' and tablename = '${TABELA}';
    `).trim();
    expect(
      quantas,
      "alguém criou policy: a tabela passa a ser SERVIDA pelo PostgREST — mova-a para TABLES do rls-isolation no mesmo commit",
    ).toBe("0");
  });

  it("é tenant-aware de verdade — `organization_id` NOT NULL com FK em cascata", () => {
    const coluna = sql(`
      select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = '${TABELA}'
         and column_name = 'organization_id';
    `).trim();
    expect(coluna, "`crm_locations` não tem organization_id").toBe("NO");

    const cascata = sql(`
      select count(*) from information_schema.table_constraints tc
       join information_schema.referential_constraints rc
         on rc.constraint_name = tc.constraint_name
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
       where tc.table_schema = 'public' and tc.table_name = '${TABELA}'
         and tc.constraint_type = 'FOREIGN KEY'
         and kcu.column_name = 'organization_id'
         and rc.delete_rule = 'CASCADE';
    `).trim();
    expect(cascata, "a FK de organization_id não é ON DELETE CASCADE").not.toBe("0");
  });
});
