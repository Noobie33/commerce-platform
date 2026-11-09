import type { MigrationInterface, QueryRunner } from 'typeorm';

// Patch the existing function bodies in place: their signatures, ACLs, SECURITY
// DEFINER ownership, search_path, locking and replay machinery stay unchanged.
// Every anchor is unique and checked, so an unexpected baseline fails atomically.
export class RetailOnly1794111000000 implements MigrationInterface {
  private async change(r: QueryRunner, reverse = false) {
    const version = (await r.query('SELECT version FROM app_schema_version WHERE singleton'))[0]
      ?.version;
    if (version !== (reverse ? 13 : 12)) throw Error('Unexpected retail migration schema version');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported retail schema');
    const s = '"' + name + '"';
    const changes: [string, [string, string][]][] = [
      [
        'customer_save',
        [
          [
            'hash:=encode(sha256',
            "IF operation='credit' OR payload->>'segment' IS DISTINCT FROM 'retail' THEN RAISE EXCEPTION 'CUSTOMER_RETAIL_ONLY';END IF;\n hash:=encode(sha256",
          ],
          [
            "IF previous.version<>expected THEN RAISE EXCEPTION 'CUSTOMER_STALE';END IF;",
            "IF previous.version<>expected THEN RAISE EXCEPTION 'CUSTOMER_STALE';END IF;\n IF previous.segment<>'retail' THEN RAISE EXCEPTION 'CUSTOMER_RETAIL_ONLY';END IF;",
          ],
        ],
      ],
      [
        'sales_draft_save',
        [
          [
            'hash:=encode(sha256',
            "IF operation<>'cancel' THEN\n IF payload->>'channel' IS DISTINCT FROM 'retail' OR payload->>'priceReason' IS DISTINCT FROM '' THEN RAISE EXCEPTION 'SALES_RETAIL_ONLY';END IF;\n IF jsonb_typeof(payload->'lines')='array' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'lines') x WHERE x->>'priceMode' IS DISTINCT FROM 'catalog') THEN RAISE EXCEPTION 'SALES_RETAIL_ONLY';END IF;END IF;\n END IF;\n hash:=encode(sha256",
          ],
          [
            "IF previous.status<>'draft' THEN RAISE EXCEPTION 'SALES_STATE';END IF;",
            `IF previous.status<>'draft' THEN RAISE EXCEPTION 'SALES_STATE';END IF;\n IF operation='update' AND(previous.channel<>'retail' OR EXISTS(SELECT 1 FROM ${s}.sales_order_lines l WHERE l.order_id=previous.id AND l.price_mode<>'catalog')) THEN RAISE EXCEPTION 'SALES_RETAIL_ONLY';END IF;`,
          ],
          [
            "IF customer.segment NOT IN(payload->>'channel','both')",
            "IF customer.segment<>'retail'",
          ],
        ],
      ],
      [
        'sales_reservation_post',
        [
          [
            'hash:=encode(sha256',
            `IF operation='hold' AND(po.channel<>'retail' OR EXISTS(SELECT 1 FROM ${s}.sales_order_lines l WHERE l.order_id=po.id AND l.price_mode<>'catalog')) THEN RAISE EXCEPTION 'RESERVATION_RETAIL_ONLY';END IF;\n hash:=encode(sha256`,
          ],
          [
            "IF operation='hold' THEN\n",
            `IF operation='hold' THEN\n IF po.channel<>'retail' OR EXISTS(SELECT 1 FROM ${s}.sales_order_lines l WHERE l.order_id=po.id AND l.price_mode<>'catalog') THEN RAISE EXCEPTION 'RESERVATION_RETAIL_ONLY';END IF;\n`,
          ],
          ["AND segment IN(po.channel,'both') FOR SHARE", "AND segment='retail' FOR SHARE"],
        ],
      ],
    ];
    for (const [fn, replacements] of changes) {
      let definition = (
        await r.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [
          `${s}.${fn}(uuid,uuid,uuid,jsonb)`,
        ])
      )[0].definition as string;
      for (const pair of reverse ? [...replacements].reverse() : replacements) {
        const [from, to] = reverse ? [pair[1], pair[0]] : pair;
        if (definition.split(from).length !== 2)
          throw Error('Unexpected retail migration anchor: ' + fn);
        definition = definition.replace(from, to);
      }
      await r.query(definition);
    }
  }
  async up(r: QueryRunner) {
    await this.change(r);
    await r.query('UPDATE app_schema_version SET version=13 WHERE singleton');
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM customers LIMIT 1')).length)
      throw Error(
        'Cannot re-enable retired trade policies with customer history; use a reviewed forward migration',
      );
    await this.change(r, true);
    await r.query('UPDATE app_schema_version SET version=12 WHERE singleton');
  }
}
