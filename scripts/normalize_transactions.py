#!/usr/bin/env python3
"""Normalize brokerage CSV/XLS exports into a single unified transaction file."""

from __future__ import annotations

import csv
import glob
import re
import uuid
from io import StringIO
from pathlib import Path

import pandas as pd

UPLOAD_DIR = Path("/home/ubuntu/.cursor/projects/workspace/uploads")
OUTPUT_PATH = Path("/workspace/data/normalized_transactions.csv")

FILE_MAP = {
    "49dc": ("아버지", "일반계좌", "아버지 일반계좌 250101-260723 거래내역.csv"),
    "4b63": ("아버지", "ISA중개형", "아버지 ISA중개형 250101-260723 거래내역.csv"),
    "2eeb": ("연주", "개인연금", "연주 개인연금 250201-260723 일별주문체결.csv"),
    "ace7": ("연주", "IRP", "연주 IRP 250101-260723 거래내역.xls"),
    "db40": ("연주", "ISA중개형", "연주 ISA중개형 250201-260723 일별주문체결.csv"),
    "4aa9": ("현우", "아버지주식", "현우 아버지주식.csv"),
    "a2ba": ("현우", "연금저축(세액)", "현우 연금저축(세액).csv"),
    "6707": ("현우", "일반세금우대", "현우 일반세금우대.csv"),
    "9b36": ("현우", "ISA", "현우 ISA.csv"),
    "0b4f": ("현우", "개인IRP", "현우개인IRP-20260723.xls"),
}

OUTPUT_COLUMNS = [
    "account_owner",
    "account_type",
    "trade_date",
    "order_id",
    "symbol_code",
    "symbol_name",
    "side",
    "raw_side",
    "order_type",
    "order_condition",
    "quantity",
    "order_quantity",
    "price",
    "amount",
    "exchange",
    "trade_time",
    "fee",
    "tax",
    "is_filled",
    "source_file",
    "source_format",
]


def parse_int(value: str | int | float | None) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    cleaned = str(value).replace(",", "").strip()
    if not cleaned or cleaned.lower() == "nan":
        return 0
    return int(float(cleaned))


def parse_float(value: str | int | float | None) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).replace(",", "").strip()
    if not cleaned or cleaned.lower() == "nan":
        return 0.0
    return float(cleaned)


def normalize_date(value: str) -> str:
    value = value.strip().replace(".", "/").replace("-", "/")
    parts = value.split("/")
    if len(parts) != 3:
        return value
    year, month, day = parts
    if len(year) == 2:
        year = f"20{year}"
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def normalize_side(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return "OTHER"
    if "매수" in raw and "취소" in raw:
        return "CANCEL"
    if "매도" in raw and "취소" in raw:
        return "CANCEL"
    if "정정" in raw:
        return "MODIFY"
    if "거부" in raw:
        return "REJECT"
    if "분배금" in raw or "배당" in raw:
        return "DIVIDEND"
    if "부담금" in raw or "입금" in raw:
        return "DEPOSIT"
    if "매수" in raw:
        return "BUY"
    if "매도" in raw:
        return "SELL"
    return "OTHER"


def resolve_file(key: str) -> Path:
    matches = glob.glob(str(UPLOAD_DIR / f"*{key}*"))
    if not matches:
        raise FileNotFoundError(f"Missing upload for key {key}")
    return Path(matches[0])


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            with path.open(encoding=encoding) as handle:
                return list(csv.DictReader(handle))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Unable to decode CSV: {path}")


def normalize_csv(key: str) -> list[dict]:
    owner, account_type, source_label = FILE_MAP[key]
    path = resolve_file(key)
    rows = read_csv_rows(path)
    normalized: list[dict] = []

    for row in rows:
        filled_qty = parse_int(row.get("총체결수량"))
        normalized.append(
            {
                "account_owner": owner,
                "account_type": account_type,
                "trade_date": normalize_date(row.get("주문일", "")),
                "order_id": row.get("주문번호", "").strip(),
                "symbol_code": row.get("코드", "").strip(),
                "symbol_name": row.get("종목명", "").strip(),
                "side": normalize_side(row.get("매매구분", "")),
                "raw_side": row.get("매매구분", "").strip(),
                "order_type": row.get("주문구분", "").strip(),
                "order_condition": row.get("조건", "").strip(),
                "quantity": filled_qty,
                "order_quantity": parse_int(row.get("주문수량")),
                "price": parse_float(row.get("평균가")),
                "amount": parse_float(row.get("총체결금액")),
                "exchange": row.get("거래소", "").strip(),
                "trade_time": row.get("주문시각", "").strip(),
                "fee": "",
                "tax": "",
                "is_filled": filled_qty > 0,
                "source_file": source_label,
                "source_format": "csv_order",
            }
        )

    return normalized


def normalize_irp(key: str) -> list[dict]:
    owner, account_type, source_label = FILE_MAP[key]
    path = resolve_file(key)
    df = pd.read_html(path)[0]
    cols = list(df.columns)

    normalized: list[dict] = []
    current: dict | None = None

    for _, row in df.iterrows():
        date_val = row[cols[0]]
        if pd.notna(date_val) and re.match(r"\d{4}", str(date_val)):
            if current:
                normalized.append(current)
            qty = parse_float(row[cols[2]])
            amount = parse_float(row[cols[3]])
            price = round(amount / qty, 4) if qty else 0.0
            current = {
                "account_owner": owner,
                "account_type": account_type,
                "trade_date": normalize_date(str(date_val)),
                "order_id": str(uuid.uuid4()),
                "symbol_code": "",
                "symbol_name": str(row[cols[1]]).strip() if pd.notna(row[cols[1]]) else "",
                "side": "OTHER",
                "raw_side": "",
                "order_type": "",
                "order_condition": "",
                "quantity": int(qty) if qty == int(qty) else qty,
                "order_quantity": int(qty) if qty == int(qty) else qty,
                "price": price,
                "amount": amount,
                "exchange": "",
                "trade_time": "",
                "fee": parse_float(row[cols[4]]),
                "tax": "",
                "is_filled": qty > 0 or amount > 0,
                "source_file": source_label,
                "source_format": "xls_irp",
            }
            continue

        if current is None:
            continue

        detail = str(row[cols[1]]).strip() if pd.notna(row[cols[1]]) else ""
        if detail:
            current["raw_side"] = detail
            current["side"] = normalize_side(detail)

        time_val = row[cols[5]]
        if pd.notna(time_val):
            current["trade_time"] = str(time_val).strip()

        order_date = row[cols[0]]
        if pd.notna(order_date) and re.match(r"\d{4}", str(order_date)):
            # Some IRP rows include a separate order date on the second line.
            current["trade_date"] = normalize_date(str(order_date))

        if pd.notna(row[cols[3]]):
            current["amount"] = parse_float(row[cols[3]])
        if pd.notna(row[cols[4]]):
            current["tax"] = parse_float(row[cols[4]])

    if current:
        normalized.append(current)

    return normalized


def main() -> None:
    records: list[dict] = []
    for key in FILE_MAP:
        if key in {"ace7", "0b4f"}:
            records.extend(normalize_irp(key))
        else:
            records.extend(normalize_csv(key))

    records.sort(key=lambda item: (item["trade_date"], item["account_owner"], item["account_type"], item["order_id"]))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(records)

    print(f"Wrote {len(records)} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
