FROM python:3.11-slim

RUN useradd -m -u 1000 -s /bin/bash sandbox

RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    pandas==2.2.0 \
    scipy==1.12.0 \
    sympy==1.12 \
    matplotlib==3.8.2 \
    seaborn==0.13.2 \
    scikit-learn==1.4.0 \
    requests==2.31.0 \
    beautifulsoup4==4.12.3 \
    lxml==5.1.0 \
    pyyaml==6.0.1 \
    jsonschema==4.21.1 \
    python-dateutil==2.8.2 \
    pytz==2024.1 \
    regex==2023.12.25 \
    humanize==4.9.0 \
    tabulate==0.9.0 \
    rich==13.7.0 \
    && rm -rf /root/.cache

COPY runner.py /runner.py
RUN chmod 555 /runner.py

RUN mkdir -p /sandbox && chown sandbox:sandbox /sandbox
WORKDIR /sandbox

USER sandbox

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOME=/sandbox
# Configure OpenBLAS/numpy to use single thread (avoids NPROC limit issues)
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV NUMEXPR_NUM_THREADS=1

ENTRYPOINT ["python", "/runner.py"]

