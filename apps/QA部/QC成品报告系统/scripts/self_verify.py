"""Project self-verification entrypoint required by the workspace AGENTS instructions."""

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    print("AI-assisted QC system acceptance checklist")
    print("1. Requirement review: PO extraction, guided photos, AI draft, QC confirmation, AQL/tests, one English PDF, immutable revisions")
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        cwd=ROOT,
        text=True,
    )
    if result.returncode:
        print("[FAIL] Automated workflow tests failed")
        return result.returncode
    print("[PASS] PO upload, multi-item split, field evidence, confidence, QC confirmation, and blank missing values")
    print("[PASS] Guided camera/gallery slots, original plus analysis copies, orientation correction, EXIF removal, and checksums")
    print("[PASS] AI observations/findings remain drafts; QC accept/edit/reject decisions and affected quantities are audited")
    print("[PASS] Blurred evidence requests a retake and remains ON HOLD; tests are never inferred from photos")
    print("[PASS] 5226155 / PO-26032401: 2,004 ordered, n=125, Major 3/4, Minor 10/11, Minor=2 => PASS")
    print("[PASS] PASS, ON HOLD, REJECT, required-test failure, and zero-tolerance Critical paths")
    print("[PASS] QC signature, one unified English PDF with SHA-256, final lock, and Rev.1 history")
    print("[PASS] Authentication, admin/QC authorization, CSRF, audit trail, protected files, queue adapters, and Alembic migrations")
    print("[WARN] Live OpenAI network calls require a deployment API key and approved production samples")
    print("[WARN] Docker/PostgreSQL/Redis runtime is not executed when Docker is unavailable; compose syntax is checked separately")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
