"""gspread + Drive client wrapper using a GCP service account.

Reads creds path from GOOGLE_SERVICE_ACCOUNT_PATH env. Authorizes against
the Sheets + Drive scopes needed to list, create, and write workbooks
inside the configured Drive folder (GOOGLE_DRIVE_FOLDER_ID).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("scout")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


class SheetsClient:
    def __init__(
        self,
        credentials_path: str | Path | None = None,
        drive_folder_id: str | None = None,
    ):
        self.credentials_path = Path(credentials_path or os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH", ""))
        self.drive_folder_id = drive_folder_id or os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
        self._gc = None

    def _ensure_creds(self) -> None:
        if not self.credentials_path.exists():
            raise RuntimeError(
                f"GCP creds not found at {self.credentials_path}. "
                "Set GOOGLE_SERVICE_ACCOUNT_PATH in .env and download the JSON key."
            )
        if not self.drive_folder_id:
            raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID not set in .env")

    @property
    def gc(self):  # type: ignore[no-untyped-def]
        if self._gc is None:
            self._ensure_creds()
            from google.oauth2.service_account import Credentials
            import gspread

            creds = Credentials.from_service_account_file(str(self.credentials_path), scopes=SCOPES)
            self._gc = gspread.authorize(creds)
        return self._gc

    def list_workbooks_in_folder(self) -> list[dict[str, Any]]:
        """Returns a list of {id, name} for every spreadsheet in the configured folder."""
        self._ensure_creds()
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build  # type: ignore

        creds = Credentials.from_service_account_file(str(self.credentials_path), scopes=SCOPES)
        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
        q = (
            f"'{self.drive_folder_id}' in parents "
            "and mimeType='application/vnd.google-apps.spreadsheet' "
            "and trashed=false"
        )
        items = drive.files().list(q=q, fields="files(id,name)").execute().get("files", [])
        return items

    def open_or_create(self, name: str):
        """Open the workbook with `name` from the configured folder; create if missing."""
        self._ensure_creds()
        existing = [w for w in self.list_workbooks_in_folder() if w["name"] == name]
        if existing:
            return self.gc.open_by_key(existing[0]["id"])
        wb = self.gc.create(name, folder_id=self.drive_folder_id)
        log.info("created Sheets workbook %r in folder %s", name, self.drive_folder_id)
        return wb
