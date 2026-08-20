import json
import logging

from figure_detection.logging import JsonFormatter, configure_logging
from figure_detection.worker.main import _enum_value


def test_json_formatter_includes_context_and_exception():
    try:
        raise RuntimeError("model setup failed")
    except RuntimeError:
        record = logging.getLogger("test").makeRecord(
            "test",
            logging.ERROR,
            __file__,
            1,
            "job failed",
            (),
            exc_info=__import__("sys").exc_info(),
            extra={"job_id": "job-1", "stage": "tracker"},
        )

    event = json.loads(JsonFormatter().format(record))

    assert event["job_id"] == "job-1"
    assert event["stage"] == "tracker"
    assert "RuntimeError: model setup failed" in event["exception"]


def test_configure_logging_writes_jsonl(tmp_path):
    log_path = configure_logging("worker-test", tmp_path)
    logging.getLogger("test").info("trace me", extra={"job_id": "job-2"})
    for handler in logging.getLogger().handlers:
        handler.flush()

    events = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert events[-1]["message"] == "trace me"
    assert events[-1]["job_id"] == "job-2"


def test_enum_value_accepts_database_string_and_enum():
    class Example:
        value = "analysis"

    assert _enum_value("analysis") == "analysis"
    assert _enum_value(Example()) == "analysis"
