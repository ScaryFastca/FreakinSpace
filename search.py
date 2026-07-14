import urllib.request
import tarfile
import io
import gzip

url = "https://arxiv.org/e-print/2307.08785"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
try:
    response = urllib.request.urlopen(req).read()
    with tarfile.open(fileobj=io.BytesIO(response), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.name.endswith(".tex"):
                f = tar.extractfile(member)
                content = f.read().decode("utf-8")
                for line in content.split("\n"):
                    if "Stephenson" in line or "St2-18" in line or "DFK" in line or "UY Scuti" in line or "UY Sct" in line:
                        print(line)
except Exception as e:
    print("Error:", e)

