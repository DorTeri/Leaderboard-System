import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1709000000000 implements MigrationInterface {
  name = 'CreateUsersTable1709000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"         BIGSERIAL       PRIMARY KEY,
        "name"       VARCHAR(255)    NOT NULL,
        "image_url"  VARCHAR(1024),
        "score"      BIGINT          NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_score_id" ON "users" ("score" DESC, "id" ASC);
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_score_nonzero" ON "users" ("score" DESC, "id" ASC)
      WHERE "score" > 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_score_nonzero";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_score_id";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
  }
}
