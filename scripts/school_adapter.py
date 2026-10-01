"""SKHU read-only timetable adapter. Credentials are received on stdin only.

Based on the user's sugangauto_python3 portal/TIS and enrollment flow.
No course registration, cancellation, grade or attendance operations.
"""
import html
import json
import re
import secrets
import sys
import uuid
import time
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse, parse_qs, unquote_plus
import requests

HOSTS = {'portal.skhu.ac.kr', 'tis.skhu.ac.kr', 'sso.skhu.ac.kr', 'sugang.skhu.ac.kr', 'lms.skhu.ac.kr'}
HTTP_SSO_HOST = 'sso.skhu.ac.kr'
HTTP_SSO_PORT = 8080
SSO_PAGE = 'https://portal.skhu.ac.kr/html/main/sso.html'
LMS_MAIN = 'https://lms.skhu.ac.kr/ilos/main/main_form.acl'
LMS_COURSES = 'https://lms.skhu.ac.kr/ilos/mp/course_register_list_form.acl'
TIS_INDEX = 'https://tis.skhu.ac.kr/app-nexa/index.html'

class SchoolError(Exception):
    """Stable, non-sensitive reason code. Never carry a provider response or URL."""
    def __init__(self, code, destination=None):
        self.code = code
        self.destination = destination
        super().__init__(code)

def check_login_error(response):
    parsed = urlparse(response.url)
    if 'redirectmessage' not in parsed.path.lower():
        return
    # The portal URL-encodes the complete query string in Location, e.g.
    # `?returnUrl%3D...%26errorMsg%3D...`; parse_qs alone loses errorMsg.
    decoded_query = unquote_plus(parsed.query)
    match = re.search(r'errorMsg=([^&]*)', decoded_query, re.I)
    message = unquote_plus(match.group(1)) if match else ''
    if '사용자 정보가 일치하지 않습니다' in message:
        raise SchoolError('session_conflict')
    if re.search(r'(?:비밀번호|패스워드).*(?:틀|잘못|일치하지|불일치)|(?:아이디|사용자).*(?:존재하지|등록되지)', message):
        raise SchoolError('invalid_credentials')
    raise SchoolError('login_rejected')

def is_destination(response):
    parsed = urlparse(response.url)
    return (parsed.hostname == 'lms.skhu.ac.kr' and parsed.path in (
        '/ilos/main/main_form.acl', '/ilos/mp/course_register_list_form.acl')) or (
        parsed.hostname == 'tis.skhu.ac.kr' and parsed.path.startswith('/app-nexa/'))

class SchoolSession(requests.Session):
    def __init__(self):
        super().__init__()
        self.headers.update({'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                             'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'})
    def send(self, request, **kwargs):
        url = urlparse(request.url)
        allowed_https = url.scheme == 'https' and url.hostname in HOSTS
        allowed_http_sso = (url.scheme == 'http' and url.hostname == HTTP_SSO_HOST
                            and url.port == HTTP_SSO_PORT)
        if not (allowed_https or allowed_http_sso):
            # Exclude the path, query, fragment, cookies and submitted data entirely.
            host = url.hostname or ''
            safe_host = host if re.fullmatch(r'[a-z0-9.-]+\.skhu\.ac\.kr',host) else 'external-host'
            raise SchoolError('unexpected_destination',{'host':safe_host,'scheme':url.scheme if url.scheme in ('http','https') else 'other','port':url.port})
        kwargs['timeout'] = 12
        response = super().send(request, **kwargs)
        response.raise_for_status()
        return response

def encrypt(value, key):
    modulus = int(key['modulus'],16)
    size = (modulus.bit_length()+7)//8
    raw = value.encode('utf-8')
    if len(raw)>size-11:
        raise ValueError('Input too long')
    pad=bytes(secrets.randbelow(255)+1 for _ in range(size-len(raw)-3))
    return format(pow(int.from_bytes(b'\0\2'+pad+b'\0'+raw,'big'),int(key['publicExponent'],16),modulus),'x')

def chase(session, response):
    for _ in range(6):
        check_login_error(response)
        # An authenticated app contains navigation functions, not SSO instructions.
        if is_destination(response):
            return response
        body=response.text
        target=re.search(r'location\.(?:href\s*=\s*[\"\x27]([^\"\x27]+)|replace\(\s*[\"\x27]([^\"\x27]+))',body,re.I)
        meta=re.search(r'<meta[^>]+content=[\"\x27]?\d+\s*;\s*url=([^\"\x27>\s]+)',body,re.I)
        if target or meta:
            found=target or meta
            response=session.get(urljoin(response.url,html.unescape(next(g for g in found.groups() if g))),headers={'Referer':response.url})
            continue
        form=re.search(r'<form[^>]+action=[\"\x27]([^\"\x27]+)',body,re.I)
        if form and re.search(r'\.submit\s*\(',body):
            fields={}
            for tag in re.findall(r'<input\b[^>]*>',body,re.I):
                name=re.search(r'name=[\"\x27]([^\"\x27]+)',tag,re.I)
                value=re.search(r'value=[\"\x27]([^\"\x27]*)',tag,re.I)
                if name: fields[name.group(1)]=html.unescape(value.group(1)) if value else ''
            response=session.post(urljoin(response.url,html.unescape(form.group(1))),data=fields,headers={'Referer':response.url})
            continue
        return response
    check_login_error(response)
    if is_destination(response): return response
    raise SchoolError('redirect_limit')

def verify_lms_page(page):
    check_login_error(page)
    if '사용자 정보가 일치하지 않습니다' in page.text: raise SchoolError('session_conflict')
    if '접속이 종료' in page.text: raise SchoolError('session_expired')
    if urlparse(page.url).hostname != 'lms.skhu.ac.kr': raise SchoolError('session_expired')
    # Older LMS pages expose YearInfo, while the current main page renders the
    # signed-in course list directly with eclassRoom(). Either is sufficient to
    # prove the session; a semester may legitimately contain zero courses.
    if not re.search(r'YearInfo\s*\[\s*\d+\s*\]\s*=\s*[\"\x27]\d{4}\^\d',page.text) and not re.search(r'eclassRoom\s*\(',page.text):
        raise SchoolError('lms_response_changed')

def timestamp():
    return str(int(time.time() * 1000))

def fetch_enrolled(enroll, credentials):
    """SugangSiteClient.login/registered_list, restricted to read-only endpoints."""
    base='https://sugang.skhu.ac.kr'
    enroll.get(base+'/')
    enroll.post(base+'/loginPage',data={'appInfo':'0','wName':str(uuid.uuid4())},headers={'Referer':base+'/'})
    result=enroll.post(base+'/loginChk?fake='+timestamp(),data={'txtUserID':credentials['username'],'txtPwd':credentials['password']},
        headers={'Referer':base+'/loginPage','X-Requested-With':'XMLHttpRequest',
                 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}).json()
    if str(result.get('code')) not in ('200','201'): raise SchoolError('enrollment_login_failed')
    enroll.get(base+'/core/home',headers={'Referer':base+'/loginPage'})
    result=enroll.post(base+'/sugang/d/sugangList?fake='+timestamp(),data={},
        headers={'Referer':base+'/core/home','X-Requested-With':'XMLHttpRequest'}).json()
    if 'rows' not in result or not isinstance(result['rows'],list): raise SchoolError('timetable_response_changed')
    return result['rows']

def parse_open_courses(response):
    # Match GradeClient._tis_transact's dataset selection; include empty cells/CDATA.
    if len(response.encode('utf-8')) > 8_000_000 or re.search(r'<!\s*(DOCTYPE|ENTITY)',response,re.I):
        raise SchoolError('timetable_response_changed')
    try: root=ET.fromstring(response)
    except ET.ParseError: raise SchoolError('timetable_response_changed') from None
    for item in root.iter():
        if item.tag.split('}')[-1]=='Parameter' and item.get('id')=='ErrorCode' and (item.text or '').strip() not in ('','0'):
            raise SchoolError('tis_query_failed')
    datasets={}
    for dataset in root.iter():
        if dataset.tag.split('}')[-1]!='Dataset': continue
        rows=[]
        for row in dataset.iter():
            if row.tag.split('}')[-1]=='Row':
                rows.append({cell.get('id'):''.join(cell.itertext()).strip() for cell in row if cell.tag.split('}')[-1]=='Col'})
        datasets[dataset.get('id')]=rows
    if 'ds_main' not in datasets and 'output1' not in datasets: raise SchoolError('timetable_response_changed')
    return datasets.get('ds_main') or datasets.get('output1') or []

def fetch_open_courses(portal,year,semester):
    """GradeClient._fetch_open_courses and Nexacro dispatcher request."""
    trans=[{'id':'select','recvDataset':'ds_main','sqlId':'kr.co.codefarm.svcm.ul.ul03_0303004.select',
            'parameters':{'YEAR':year,'SMST_GBCD':semester,'ESTB_ASGN_CD':'','PESN_NM':'','COURSE_CNM':''},'fileOptions':None}]
    xml='<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://www.nexacroplatform.com/platform/dataset"><Parameters><Parameter id="TRANS_INFO">'+html.escape(json.dumps(trans))+'</Parameter><Parameter id="SYSTEM_MENU_CD">undefined</Parameter><Parameter id="SYSTEM_LOGGING">Y</Parameter><Parameter id="SYSTEM_CHECK_SCHE">N</Parameter></Parameters></Root>'
    response=portal.post('https://tis.skhu.ac.kr/ul/ul03_0303004?fake='+timestamp(),data=xml.encode(),
        headers={'Content-Type':'text/xml; charset=UTF-8','Referer':TIS_INDEX,'X-Requested-With':'XMLHttpRequest'})
    return parse_open_courses(response.text)

def parse_lms_course_fragment(response):
    """Parse the regular course cards returned by the current LMS."""
    courses=[]
    pattern=(r"eclassRoom\s*\(\s*['\"]([^'\"]+)['\"]\s*\).*?"
             r"class\s*=\s*['\"]content-title[^>]*>(.*?)</span>.*?"
             r"<li[^>]*><span[^>]*>.*?</span>\s*</li>\s*"
             r"<li[^>]*><span[^>]*>(.*?)</span>")
    for match in re.finditer(pattern,response,re.I|re.S):
        key=html.unescape(match.group(1)).strip()
        title=re.sub(r'<[^>]+>',' ',match.group(2))
        title=re.sub(r'\s+',' ',html.unescape(title)).strip()
        code_match=re.search(r'^(.*?)\(([A-Za-z0-9가-힣]+)-([0-9A-Za-z]+)\)\s*$',title)
        name=(code_match.group(1).strip() if code_match else title) or f'학교 과목 {len(courses)+1}'
        section=code_match.group(3) if code_match else '1'
        schedule=re.sub(r'<[^>]+>',' ',match.group(3))
        schedule=re.sub(r'\s+',' ',html.unescape(schedule)).strip() or '시간 미확인'
        courses.append({'code':f'LMS:{key[:120]}','section':section[:20], 'name':name[:120], 'schedule':schedule[:500]})
    if courses:
        return courses
    # Historical semesters currently return content cards without the
    # eclassRoom() link used by the main page. The title contains the course
    # code and section, while the last author-list item contains the schedule.
    title_pattern=(r'<p\b[^>]*class=["\'][^"\']*\bcontent-title\b[^"\']*["\'][^>]*>(.*?)</p>(.*?)'
                   r'(?=<p\b[^>]*class=["\'][^"\']*\bcontent-title\b|</body\b|$)')
    for match in re.finditer(title_pattern,response,re.I|re.S):
        title=re.sub(r'<[^>]+>',' ',match.group(1))
        title=re.sub(r'\s+',' ',html.unescape(title)).strip()
        code_match=re.search(r'^(.*?)\(([A-Za-z0-9가-힣]+)-([0-9A-Za-z]+)\)\s*$',title)
        name=(code_match.group(1).strip() if code_match else title) or f'학교 과목 {len(courses)+1}'
        code=code_match.group(2) if code_match else f'HISTORICAL-{len(courses)+1}'
        section=code_match.group(3) if code_match else '1'
        spans=[]
        for value in re.findall(r'<li\b[^>]*>.*?<span\b[^>]*>(.*?)</span>',match.group(2),re.I|re.S):
            cleaned=re.sub(r'<[^>]+>',' ',value)
            cleaned=re.sub(r'\s+',' ',html.unescape(cleaned)).strip()
            if cleaned: spans.append(cleaned)
        schedule=spans[-1] if spans else '시간 미확인'
        courses.append({'code':f'LMS:{code[:120]}','section':section[:20],
                        'name':name[:120],'schedule':schedule[:500]})
    if courses:
        return courses
    # Older and historical-semester fragments do not keep the key, title and
    # schedule in the same <li>. Match the stable key/title ordering used by
    # the reference client instead of treating the semester as unavailable.
    keys=re.findall(r"eclassRoom\s*\(\s*['\"]([^'\"]+)['\"]",response,re.I)
    titles=[]
    for value in re.findall(r'>\s*([^<>]{3,160}\([^<>)]{1,40}\))\s*<',response):
        title=re.sub(r'\s+',' ',html.unescape(value)).strip()
        if title not in titles: titles.append(title)
    for index,key in enumerate(keys):
        title=titles[index] if index<len(titles) else f'학교 과목 {index+1}'
        code_match=re.search(r'^(.*?)\(([A-Za-z0-9가-힣]+)-([0-9A-Za-z]+)\)\s*$',title)
        name=(code_match.group(1).strip() if code_match else title) or f'학교 과목 {index+1}'
        section=code_match.group(3) if code_match else '1'
        courses.append({'code':f'LMS:{html.unescape(key).strip()[:120]}','section':section[:20],
                        'name':name[:120],'schedule':'시간 미확인'})
    return courses

def lms_fallback(portal,year,semester,warning):
    courses=fetch_lms_courses(portal,year,semester)
    return {'year':int(year),'semester':semester,'partial':True,'warning':warning,'courses':courses}

def fetch_lms_courses(portal, year, semester):
    """Read the current LMS course page when the separate enrollment site rejects access.

    The reference client uses course_register_list.acl and YearInfo. The current
    LMS first redirects that request to main_form.acl, where regular courses are
    rendered as ``eclassRoom(KJKEY)`` rows containing the actual schedule.
    """
    # Reuse the authenticated portal session for the LMS SSO hop, matching
    # LmsClient.login_with_portal_session in the reference project.
    lms_sso=portal.get('https://lms.skhu.ac.kr/ilos/sso/sso.jsp',headers={'Referer':'https://portal.skhu.ac.kr/'})
    chase(portal,lms_sso)
    page=portal.get(LMS_COURSES,headers={'Referer':LMS_MAIN})
    verify_lms_page(page)
    years=re.findall(r'YearInfo\s*\[\s*\d+\s*\]\s*=\s*[\"\x27](\d{4})\^(\d)',page.text)
    # LMS uses 3 for 2학기 while StudySpace keeps the user-facing 1~4 order.
    lms_semester={'1':'1','2':'3','3':'2','4':'4'}.get(str(semester),str(semester))
    if years:
        if (str(year),lms_semester) not in years:
            raise SchoolError('semester_mismatch')
        response=portal.post('https://lms.skhu.ac.kr/ilos/mp/course_register_list.acl',
            data={'YEAR':str(year),'TERM':lms_semester,'encoding':'utf-8'},headers={'Referer':LMS_COURSES})
        if response.status_code != 200 or '접속이 종료' in response.text:
            raise SchoolError('lms_response_changed')
        courses=parse_lms_course_fragment(response.text)
        if courses: return courses
        raise SchoolError('lms_response_changed')

    # Current main_form.acl layout: one regular-course <li> contains the LMS
    # key, course name/code and a human-readable schedule span.
    courses=[]
    for block in re.findall(r'<li\b[^>]*>(.*?)</li>',page.text,re.I|re.S):
        key_match=re.search(r'eclassRoom\s*\(\s*[\"\x27]([^\"\x27]+)',block,re.I)
        if not key_match: continue
        key=html.unescape(key_match.group(1)).strip()
        if not key.startswith('A'+str(year)): continue
        title_match=re.search(r'\btitle\s*=\s*[\"\x27]([^\"\x27]*)',block,re.I)
        name=re.sub(r'\s+강의실\s+들어가기\s*$','',html.unescape(title_match.group(1) if title_match else ''),flags=re.I).strip()
        text=re.sub(r'<[^>]+>',' ',block)
        text=re.sub(r'\s+',' ',html.unescape(text)).strip()
        code_match=re.search(r'\(([A-Za-z0-9가-힣]+)-([0-9A-Za-z]+)\)',text)
        if not name and code_match: name=text[:120]
        if not name: name=f'학교 과목 {len(courses)+1}'
        schedule_match=re.search(r'<span\b[^>]*>(.*?)</span>',block,re.I|re.S)
        schedule=re.sub(r'<[^>]+>',' ',schedule_match.group(1) if schedule_match else '')
        schedule=re.sub(r'\s+',' ',html.unescape(schedule)).strip() or '시간 미확인'
        courses.append({'code':f"LMS:{key[:120]}",'section':'1','name':name[:120],'schedule':schedule[:500]})
    if not courses: raise SchoolError('semester_mismatch')
    return courses

def fetch(data):
    credentials=data['credentials']; year=str(data['year']); semester=data['semester']
    with SchoolSession() as portal, SchoolSession() as enroll:
        target='https://lms.skhu.ac.kr/ilos/sso/sso.jsp' if data.get('mode')=='verify' else 'https://tis.skhu.ac.kr'
        # The reference client treats this provider response as a transient SSO
        # condition and retries with a fresh portal session up to two times.
        for attempt in range(3):
            portal.cookies.clear()
            try:
                key=portal.get('https://portal.skhu.ac.kr/publickeys',headers={'Referer':SSO_PAGE}).json()
                if not isinstance(key,dict) or not all(key.get(field) for field in ('modulus','publicExponent')):
                    raise SchoolError('portal_response_changed')
                login=portal.post('https://portal.skhu.ac.kr/sso/login',data={'uid':encrypt(credentials['username'],key),'upw':encrypt(credentials['password'],key),'returnUrl':target},headers={'Referer':SSO_PAGE})
                final=chase(portal,login)
                check_login_error(final)
                if data.get('mode')=='verify':
                    page=portal.get(LMS_COURSES,headers={'Referer':LMS_MAIN})
                    verify_lms_page(page)
                    return {'authenticated':True}
                # Do not infer the session from a cookie name. The portal has used
                # both TIS-prefixed and container-managed cookie names over time.
                alive=portal.get(TIS_INDEX,allow_redirects=False,headers={'Referer':'https://portal.skhu.ac.kr/'})
                if alive.status_code in (301,302,303,307,308):
                    portal.get('https://tis.skhu.ac.kr/',headers={'Referer':'https://portal.skhu.ac.kr/'})
                    alive=portal.get(TIS_INDEX,allow_redirects=False,headers={'Referer':'https://portal.skhu.ac.kr/'})
                if alive.status_code!=200: raise SchoolError('tis_session_failed')
                break
            except SchoolError as error:
                if error.code not in ('session_conflict','tis_session_failed') or attempt == 2:
                    raise
                time.sleep(attempt + 1)
        try:
            rows=fetch_enrolled(enroll,credentials)
        except SchoolError as error:
            if error.code not in ('enrollment_login_failed','enrollment_response_changed'):
                raise
            # LMS authentication succeeded; keep the user's learning space usable even
            # when the separate enrollment site denies the current student session.
            return lms_fallback(portal,year,semester,'수강신청 사이트가 현재 신청 기간이 아니어서 LMS에서 과목을 확인했습니다.')
        # The enrollment site only exposes the current registration period.
        # A historical semester must be read from LMS instead of rejecting the
        # valid user-selected year/semester because current rows differ.
        if rows and not any(str(row.get('year',''))==year and str(row.get('smst_gbcd',row.get('smst','')))==semester for row in rows):
            return lms_fallback(portal,year,semester,'선택한 과거 학기는 LMS 수강 이력에서 불러왔습니다.')
        opened={(row.get('COURSE_CD'),row.get('CLAS')):row for row in fetch_open_courses(portal,year,semester)}
        courses=[]
        for row in rows:
            # Fail closed if the enrolled semester cannot be established.
            row_year=str(row.get('year',''))
            row_semester=str(row.get('smst_gbcd',row.get('smst','')))
            if row_year != year or row_semester != semester: raise SchoolError('semester_mismatch')
            code=str(row.get('course_cd','')); section=str(row.get('clas',''))
            name=str(row.get('course_nm',''))
            if not code or not section or not name: raise SchoolError('timetable_response_changed')
            match=opened.get((code,section),{})
            courses.append({'code':code,'section':section,'name':name[:120],'schedule':match.get('TITA','시간 미확인')[:500]})
        return {'year':int(year),'semester':semester,'courses':courses}

def main():
    try:
        result=fetch(json.load(sys.stdin))
        output=json.dumps(result,ensure_ascii=False)
        if len(output.encode())>50000: raise ValueError('Response too large')
        print(output)
    except SchoolError as error:
        result={'error':error.code}
        if error.destination: result['destination']=error.destination
        print(json.dumps(result))
    except requests.Timeout:
        print('{"error":"network_timeout"}')
    except requests.RequestException:
        print('{"error":"school_unavailable"}')
    except (ValueError,KeyError,TypeError):
        print('{"error":"school_response_changed"}')
    except Exception:
        print('{"error":"adapter_failed"}')

if __name__ == '__main__':
    main()
