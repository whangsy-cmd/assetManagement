"""
주식 일별 종가 데이터 수집 스크립트
사용법: python fetch_stock.py [티커] [시작일] [종료일] [옵션]
예시:
  python fetch_stock.py 005930        # 삼성전자, 최근 2년
  python fetch_stock.py AAPL 2023-01-01 2024-12-31
  python fetch_stock.py 005930 2022-01-01 2024-12-31 --save
  python fetch_stock.py SOXL 2025-01-01 2026-12-31 --db     # assetManagement DB에 바로 저장
  python fetch_stock.py               # 대화형 모드

DB 직접 저장(--db) 준비물:
  Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성"으로 받은 JSON을
  이 스크립트와 같은 폴더에 serviceAccountKey.json 으로 저장 (프로젝트: assetmanagement-f8c45).
  옵션: --name=종목명 --uid=... --email=... --key=키파일경로 (기본 이메일: whangsy@gmail.com)
"""

import sys
import os
import subprocess
import importlib

# Windows 터미널 UTF-8 출력
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── 패키지 자동 설치 ─────────────────────────────────────────────────────────
REQUIRED = {"yfinance": "yfinance", "FinanceDataReader": "finance-datareader"}

def ensure(pkg, pip_name):
    try:
        importlib.import_module(pkg)
        return
    except ImportError:
        pass
    print(f"[설치] {pip_name} 설치 중...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pip_name, "-q",
                               "--disable-pip-version-check", "--no-warn-script-location"],
                              stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pip_name, "-q",
                               "--user", "--disable-pip-version-check", "--no-warn-script-location"],
                              stderr=subprocess.DEVNULL)
    importlib.invalidate_caches()
    # sys.path에 user site-packages 추가
    import site
    for p in site.getusersitepackages() if isinstance(site.getusersitepackages(), list) else [site.getusersitepackages()]:
        if p not in sys.path:
            sys.path.insert(0, p)

for pkg, pip_name in REQUIRED.items():
    ensure(pkg, pip_name)

importlib.invalidate_caches()
import yfinance as yf
import FinanceDataReader as fdr
from datetime import datetime, timedelta

# ── 상수 ────────────────────────────────────────────────────────────────────
KRX_CODES = {
    "삼성전자": "005930", "sk하이닉스": "000660", "lg에너지솔루션": "373220",
    "삼성바이오로직스": "207940", "현대차": "005380", "기아": "000270",
    "셀트리온": "068270", "포스코홀딩스": "005490", "카카오": "035720",
    "네이버": "035420", "lg화학": "051910", "삼성sdi": "006400",
    "sk이노베이션": "096770", "현대모비스": "012330", "kb금융": "105560",
}

POPULAR_US = {
    "apple": "AAPL", "tesla": "TSLA", "nvidia": "NVDA", "microsoft": "MSFT",
    "amazon": "AMZN", "google": "GOOGL", "meta": "META", "netflix": "NFLX",
}

def is_krx(ticker: str) -> bool:
    """한국 종목 코드 여부 판단 (6자리 숫자)"""
    return ticker.isdigit() and len(ticker) == 6

def is_etf_index(ticker: str) -> bool:
    """KRX ETF/지수 코드 여부"""
    return ticker.isdigit() and len(ticker) != 6

# ── 데이터 수집 ──────────────────────────────────────────────────────────────
def fetch_krx(ticker: str, start: str, end: str) -> list[dict]:
    """FinanceDataReader로 KRX 종목 수집"""
    print(f"  [KRX] FinanceDataReader 조회 중... ({ticker})")
    df = fdr.DataReader(ticker, start, end)
    if df.empty:
        raise ValueError(f"데이터 없음: {ticker}")
    close_col = next((c for c in ["Close", "종가", "Adj Close"] if c in df.columns), None)
    if not close_col:
        raise ValueError(f"종가 컬럼 없음. 사용 가능한 컬럼: {list(df.columns)}")
    df = df[[close_col]].dropna()
    df.index = df.index.strftime("%Y-%m-%d")
    return [{"date": d, "close": int(v)} for d, v in df[close_col].items()]

CHUNK_DAYS = 365 * 2  # 2년씩 분할

def date_chunks(start_str: str, end_str: str) -> list[tuple[str, str]]:
    """기간이 CHUNK_DAYS 초과 시 2년 단위로 분할"""
    s = datetime.strptime(start_str, "%Y-%m-%d")
    e = datetime.strptime(end_str, "%Y-%m-%d")
    if (e - s).days <= CHUNK_DAYS:
        return [(start_str, end_str)]
    chunks, cur = [], s
    while cur < e:
        nxt = min(cur + timedelta(days=CHUNK_DAYS), e)
        chunks.append((cur.strftime("%Y-%m-%d"), nxt.strftime("%Y-%m-%d")))
        cur = nxt
    return chunks

def _yf_to_series(df, ticker_hint=""):
    """MultiIndex/단일 컬럼 모두 처리해 Close Series 반환"""
    import pandas as pd
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)  # ('Close','PLTR') → 'Close'
    return df["Close"].dropna()

def fetch_yfinance(ticker: str, start: str, end: str) -> list[dict]:
    """yfinance로 미국/한국 종목 수집 (긴 기간 자동 분할, MultiIndex 정리)
    end는 inclusive — yfinance exclusive 특성 보정으로 내부에서 +1일 처리"""
    yfTicker = ticker
    if is_krx(ticker):
        for suffix in [".KS", ".KQ"]:
            test = yf.download(ticker + suffix, start=start,
                               end=(datetime.strptime(start, "%Y-%m-%d") + timedelta(days=30)).strftime("%Y-%m-%d"),
                               progress=False, auto_adjust=True)
            if not test.empty:
                yfTicker = ticker + suffix
                break

    # yfinance end는 exclusive → +1일 해야 end 당일 데이터 포함
    end_exclusive = (datetime.strptime(end, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    chunks = date_chunks(start, end_exclusive)
    multi = len(chunks) > 1
    rows = {}

    for cs, ce in chunks:
        if multi:
            print(f"  [yfinance] {cs} ~ {ce} 구간 조회... ({yfTicker})")
        else:
            print(f"  [yfinance] 조회 중... ({yfTicker})")
        df = yf.download(yfTicker, start=cs, end=ce, progress=False, auto_adjust=True)
        if df.empty:
            continue
        series = _yf_to_series(df, yfTicker)
        for d, v in series.items():
            date_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)
            rows[date_str] = round(float(v), 2)  # 중복 날짜는 마지막 값으로 덮어씀

    if not rows:
        raise ValueError(f"데이터 없음: {yfTicker}")

    return [{"date": d, "close": v} for d, v in sorted(rows.items())]

def fetch(ticker: str, start: str, end: str, prefer: str = "auto") -> list[dict]:
    """
    데이터 수집 메인 함수
    prefer: 'fdr' | 'yf' | 'auto'
    """
    ticker = ticker.upper() if not ticker.isdigit() else ticker

    if prefer == "fdr" or (prefer == "auto" and is_krx(ticker)):
        try:
            return fetch_krx(ticker, start, end)
        except Exception as e:
            print(f"  FinanceDataReader 실패: {e}\n  yfinance로 재시도...")
            return fetch_yfinance(ticker, start, end)
    else:
        try:
            return fetch_yfinance(ticker, start, end)
        except Exception as e:
            if is_krx(ticker):
                print(f"  yfinance 실패: {e}\n  FinanceDataReader로 재시도...")
                return fetch_krx(ticker, start, end)
            raise

# ── 출력 ─────────────────────────────────────────────────────────────────────
def to_csv_text(data: list[dict]) -> str:
    return "\n".join(f"{r['date']},{r['close']}" for r in data)

def save_csv(data: list[dict], path: str):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    text = "date,close\n" + to_csv_text(data)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  저장 완료: {os.path.abspath(path)}")

# CSV 저장 위치/파일명 규칙 — 모든 모드(cli/interactive/batch) 공용
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

def csv_filename(ticker: str, start: str, end: str) -> str:
    return f"{ticker}_{start.replace('-', '')}_{end.replace('-', '')}.csv"

def print_summary(ticker: str, data: list[dict]):
    if not data:
        print("  데이터 없음")
        return
    prices = [r["close"] for r in data]
    first, last = data[0], data[-1]
    total_ret = (last["close"] - first["close"]) / first["close"] * 100
    print(f"\n  ── 요약 ───────────────────────────────")
    print(f"  종목    : {ticker}")
    print(f"  기간    : {first['date']} ~ {last['date']} ({len(data)}개 거래일)")
    print(f"  시작가  : {first['close']:,.0f}")
    print(f"  현재가  : {last['close']:,.0f}")
    print(f"  수익률  : {total_ret:+.1f}%")
    print(f"  최고가  : {max(prices):,.0f}")
    print(f"  최저가  : {min(prices):,.0f}")
    print(f"  ────────────────────────────────────\n")

def print_copyable(data: list[dict]):
    print("\n  ── HTML에 붙여넣을 CSV (복사해서 사용하세요) ──")
    print(to_csv_text(data))
    print("  ──────────────────────────────────────────────\n")

# ── Firestore 직접 저장 ────────────────────────────────────────────────────
FIREBASE_PROJECT_ID = "assetmanagement-f8c45"
DEFAULT_EMAIL = "whangsy@gmail.com"
DEFAULT_KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")

def save_to_firestore(ticker: str, name: str, data: list[dict],
                       uid: str = None, email: str = DEFAULT_EMAIL, key_path: str = DEFAULT_KEY_PATH):
    """assetManagement 앱과 동일한 users/{uid}/priceSeries/{code} 문서에 직접 병합 저장"""
    ensure("firebase_admin", "firebase-admin")
    import firebase_admin
    from firebase_admin import credentials, auth, firestore

    if not os.path.exists(key_path):
        raise FileNotFoundError(
            f"서비스 계정 키가 없습니다: {key_path}\n"
            f"  Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > '새 비공개 키 생성'으로 받은 JSON을 "
            f"이 경로에 저장하세요 (프로젝트: {FIREBASE_PROJECT_ID})."
        )

    if not firebase_admin._apps:
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred, {"projectId": FIREBASE_PROJECT_ID})

    db = firestore.client()

    if not uid:
        if not email:
            raise ValueError("--uid 또는 --email 중 하나는 지정해야 합니다.")
        uid = auth.get_user_by_email(email).uid

    doc_ref = db.collection("users").document(uid).collection("priceSeries").document(ticker)
    snap = doc_ref.get()
    existing = snap.to_dict() if snap.exists else None

    new_prices = {r["date"]: r["close"] for r in data}
    merged = {**(existing.get("prices", {}) if existing else {}), **new_prices}
    dates = sorted(merged.keys())

    doc_ref.set({
        "code": ticker,
        "name": name or (existing.get("name") if existing else ticker),
        "market": "KR" if is_krx(ticker) else "US",
        "minDate": dates[0],
        "maxDate": dates[-1],
        "prices": merged,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })

    print(f"  [DB] users/{uid}/priceSeries/{ticker} 저장 완료 — 추가 {len(new_prices)}건 / 총 {len(dates)}건")

def friendly_error(ex: Exception) -> str:
    """트레이스백 대신 원본 예외 메세지만 한 줄로 표시 (내용 번역/가공 안 함)"""
    name = type(ex).__name__
    msg = str(ex)
    return f"{name}: {msg}" if name not in ("ValueError", "FileNotFoundError") else msg

# 코드에서 의도적으로 raise하거나 외부 요인(API/네트워크)으로 발생하는, 버그가 아닌 예외만 여기 해당 — 이 경우만 트레이스백 생략
def is_known_error(ex: Exception) -> bool:
    if isinstance(ex, (ValueError, FileNotFoundError, ConnectionError, TimeoutError)):
        return True
    mod = type(ex).__module__ or ""
    return mod.startswith(("google", "grpc", "urllib3", "requests"))

# ── 인터랙티브 모드 ──────────────────────────────────────────────────────────
def interactive():
    print("=" * 52)
    print("  주식 데이터 수집기 (kelly_backtest.html 연동)")
    print("=" * 52)
    print()
    print("  [주요 한국 종목]")
    for name, code in list(KRX_CODES.items())[:6]:
        print(f"    {code}  {name}")
    print()
    print("  [주요 미국 종목]  AAPL TSLA NVDA MSFT AMZN")
    print()

    raw = input("  종목 코드 또는 이름 입력: ").strip()
    # 이름으로 검색
    ticker = KRX_CODES.get(raw.lower(), POPULAR_US.get(raw.lower(), raw))

    default_end   = datetime.today().strftime("%Y-%m-%d")
    default_start = (datetime.today() - timedelta(days=730)).strftime("%Y-%m-%d")

    s = input(f"  시작일 [{default_start}]: ").strip() or default_start
    e = input(f"  종료일 [{default_end}]: ").strip() or default_end

    save = input("  CSV 파일로 저장? [y/N]: ").strip().lower() == "y"
    to_db = input("  DB에 바로 저장? (assetManagement 앱 연동) [y/N]: ").strip().lower() == "y"

    print()
    try:
        data = fetch(ticker, s, e)
        print_summary(ticker, data)

        if save:
            save_csv(data, os.path.join(DATA_DIR, csv_filename(ticker, s, e)))
        if to_db:
            save_to_firestore(ticker, raw if raw != ticker else "", data)
        if not save and not to_db:
            print_copyable(data)
            input("  Enter를 누르면 종료...")

    except Exception as ex:
        if not is_known_error(ex):
            raise
        print(f"\n  오류: {friendly_error(ex)}")

# ── CLI 모드 ──────────────────────────────────────────────────────────────────
def cli(args: list[str]):
    # 기본값
    end   = datetime.today().strftime("%Y-%m-%d")
    start = (datetime.today() - timedelta(days=730)).strftime("%Y-%m-%d")
    save  = "--save" in args or "-s" in args
    copy  = "--copy" in args or "-c" in args
    to_db = "--db" in args
    prefer = "fdr" if "--fdr" in args else ("yf" if "--yf" in args else "auto")

    def opt(prefix, default=None):
        hit = next((a for a in args if a.startswith(prefix)), None)
        return hit[len(prefix):] if hit else default

    db_name  = opt("--name=", "")
    db_uid   = opt("--uid=", None)
    db_email = opt("--email=", DEFAULT_EMAIL)
    db_key   = opt("--key=", DEFAULT_KEY_PATH)

    clean = [a for a in args if not a.startswith("-")]

    ticker = KRX_CODES.get(clean[0].lower(), POPULAR_US.get(clean[0].lower(), clean[0])) if len(clean) > 0 else None
    if len(clean) > 1: start = clean[1]
    if len(clean) > 2: end   = clean[2]

    if not ticker:
        print(__doc__)
        sys.exit(0)

    print(f"\n  종목: {ticker}  기간: {start} ~ {end}")
    data = fetch(ticker, start, end, prefer)
    print_summary(ticker, data)

    if save:
        save_csv(data, os.path.join(DATA_DIR, csv_filename(ticker, start, end)))
    if to_db:
        save_to_firestore(ticker, db_name, data, uid=db_uid, email=db_email, key_path=db_key)
    if not save and not to_db:
        print_copyable(data)

# ── 배치 모드 (여러 종목 한번에) ─────────────────────────────────────────────
def batch(tickers: list[str], start: str, end: str, out_dir: str = DATA_DIR):
    """여러 종목을 한 번에 수집해 각각 CSV로 저장"""
    results = {}
    for t in tickers:
        print(f"\n[{t}] 수집 중...")
        try:
            data = fetch(t, start, end)
            fname = os.path.join(out_dir, csv_filename(t, start, end))
            save_csv(data, fname)
            results[t] = {"ok": True, "rows": len(data)}
        except Exception as ex:
            results[t] = {"ok": False, "error": str(ex)}
            print(f"  실패: {ex}")

    print("\n  ── 배치 결과 ───────────────────")
    for t, r in results.items():
        if r["ok"]:
            print(f"  OK  {t:12s}  {r['rows']}행")
        else:
            print(f"  NG  {t:12s}  {r['error']}")

# ── 진입점 ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    args = sys.argv[1:]

    # 배치 모드: python fetch_stock.py --batch 005930 AAPL TSLA
    if "--batch" in args:
        idx = args.index("--batch")
        tickers = [a for a in args[idx+1:] if not a.startswith("-")]
        end   = datetime.today().strftime("%Y-%m-%d")
        start = (datetime.today() - timedelta(days=730)).strftime("%Y-%m-%d")
        for a in args:
            if a.startswith("--start="): start = a.split("=")[1]
            if a.startswith("--end="):   end   = a.split("=")[1]
        batch(tickers, start, end)

    elif not args:
        interactive()
    else:
        try:
            cli(args)
        except Exception as ex:
            if not is_known_error(ex):
                raise
            print(f"\n  오류: {friendly_error(ex)}")
            sys.exit(1)
