namespace IndoShipping.Api.Features.Bootstrap;

public static class ScheduleCustomerSchema
{
    // Do not rewrite raw_rows: historical completion hashes and line IDs depend on them.
    public const string SchemaSql = """
        DO $$
        DECLARE entry record; owners text[];
        BEGIN
            -- One statement owns the lock and all DDL/data changes atomically.
            LOCK TABLE schedules IN ACCESS EXCLUSIVE MODE;
            IF NOT EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid='schedules'::regclass AND attname='customer' AND NOT attisdropped) THEN
                ALTER TABLE schedules ADD COLUMN customer TEXT NOT NULL DEFAULT 'TOMY';
                FOR entry IN SELECT id,raw_rows FROM schedules ORDER BY id LOOP
                    SELECT array_agg(DISTINCT CASE
                        WHEN lower(trim(r->>'customer'))='tomy' THEN 'TOMY'
                        WHEN trim(r->>'customer') ~* '^spin\s*(master)?$' THEN 'Spin Master'
                        ELSE '__unsupported__' END) INTO owners
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entry.raw_rows)='array'
                        THEN entry.raw_rows ELSE '[]'::jsonb END) r
                    WHERE trim(COALESCE(r->>'customer',''))<>'';
                    IF cardinality(owners)>1 OR '__unsupported__'=ANY(owners) THEN
                        RAISE EXCEPTION 'Schedule customer migration requires review (schedule id %)',entry.id;
                    END IF;
                    -- The previous importer explicitly used TOMY when customer was
                    -- absent. Explicit historical ownership always wins over that default.
                    IF cardinality(owners)=1 THEN
                        UPDATE schedules SET customer=owners[1] WHERE id=entry.id;
                    END IF;
                END LOOP;
            END IF;
            FOR entry IN
                SELECT conname FROM pg_constraint
                WHERE conrelid='schedules'::regclass AND contype='u'
                  AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
                    WHERE attrelid='schedules'::regclass AND attname='week_label')]::smallint[]
            LOOP
                EXECUTE format('ALTER TABLE schedules DROP CONSTRAINT %I',entry.conname);
            END LOOP;
            FOR entry IN
                SELECT indexrelid::regclass AS index_name FROM pg_index
                WHERE indrelid='schedules'::regclass AND indisunique AND indnatts=1
                  AND indkey[0]=(SELECT attnum FROM pg_attribute
                    WHERE attrelid='schedules'::regclass AND attname='week_label')
            LOOP
                EXECUTE format('DROP INDEX %s',entry.index_name);
            END LOOP;
            CREATE UNIQUE INDEX IF NOT EXISTS ix_schedules_customer_week
                ON schedules(customer,week_label);
        END $$;
        """;
}
