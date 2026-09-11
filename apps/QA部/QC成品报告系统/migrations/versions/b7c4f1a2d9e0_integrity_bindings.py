"""Bind AI evidence, QC signatures, and immutable report versions.

Revision ID: b7c4f1a2d9e0
Revises: 93bea73d873a
Create Date: 2026-07-15 11:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7c4f1a2d9e0"
down_revision: Union[str, Sequence[str], None] = "93bea73d873a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def _unique_names(table: str) -> set[str]:
    return {item.get("name") for item in sa.inspect(op.get_bind()).get_unique_constraints(table) if item.get("name")}


def _index_names(table: str) -> set[str]:
    return {item.get("name") for item in sa.inspect(op.get_bind()).get_indexes(table) if item.get("name")}


def upgrade() -> None:
    report_columns = _columns("reports")
    report_uniques = _unique_names("reports")
    with op.batch_alter_table("reports") as batch:
        if "signed_by_id" not in report_columns:
            batch.add_column(sa.Column("signed_by_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_reports_signed_by_id_users", "users", ["signed_by_id"], ["id"])
        if "signature_checksum" not in report_columns:
            batch.add_column(sa.Column("signature_checksum", sa.String(length=64), nullable=False, server_default=""))
        if "signed_data_checksum" not in report_columns:
            batch.add_column(sa.Column("signed_data_checksum", sa.String(length=64), nullable=False, server_default=""))
        if "uq_reports_number_revision" not in report_uniques:
            batch.create_unique_constraint("uq_reports_number_revision", ["report_no", "revision"])

    run_columns = _columns("ai_analysis_runs")
    with op.batch_alter_table("ai_analysis_runs") as batch:
        if "input_manifest" not in run_columns:
            batch.add_column(sa.Column("input_manifest", sa.Text(), nullable=False, server_default="[]"))
        if "input_manifest_checksum" not in run_columns:
            batch.add_column(sa.Column("input_manifest_checksum", sa.String(length=64), nullable=False, server_default=""))
    if "uq_ai_analysis_active_report" not in _index_names("ai_analysis_runs"):
        op.create_index(
            "uq_ai_analysis_active_report",
            "ai_analysis_runs",
            ["report_id"],
            unique=True,
            sqlite_where=sa.text("status IN ('queued','processing','retrying')"),
            postgresql_where=sa.text("status IN ('queued','processing','retrying')"),
        )

    version_columns = _columns("report_versions")
    version_uniques = _unique_names("report_versions")
    with op.batch_alter_table("report_versions") as batch:
        if "signed_by_id" not in version_columns:
            batch.add_column(sa.Column("signed_by_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_report_versions_signed_by_id_users", "users", ["signed_by_id"], ["id"])
        if "signed_at" not in version_columns:
            batch.add_column(sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True))
        if "signature_checksum" not in version_columns:
            batch.add_column(sa.Column("signature_checksum", sa.String(length=64), nullable=False, server_default=""))
        if "data_checksum" not in version_columns:
            batch.add_column(sa.Column("data_checksum", sa.String(length=64), nullable=False, server_default=""))
        if "uq_report_versions_output" not in version_uniques:
            batch.create_unique_constraint("uq_report_versions_output", ["report_id", "template", "language"])


def downgrade() -> None:
    if "uq_ai_analysis_active_report" in _index_names("ai_analysis_runs"):
        op.drop_index("uq_ai_analysis_active_report", table_name="ai_analysis_runs")
    with op.batch_alter_table("report_versions") as batch:
        if "uq_report_versions_output" in _unique_names("report_versions"):
            batch.drop_constraint("uq_report_versions_output", type_="unique")
        for column in ("data_checksum", "signature_checksum", "signed_at", "signed_by_id"):
            if column in _columns("report_versions"):
                batch.drop_column(column)
    with op.batch_alter_table("ai_analysis_runs") as batch:
        for column in ("input_manifest_checksum", "input_manifest"):
            if column in _columns("ai_analysis_runs"):
                batch.drop_column(column)
    with op.batch_alter_table("reports") as batch:
        if "uq_reports_number_revision" in _unique_names("reports"):
            batch.drop_constraint("uq_reports_number_revision", type_="unique")
        for column in ("signed_data_checksum", "signature_checksum", "signed_by_id"):
            if column in _columns("reports"):
                batch.drop_column(column)
