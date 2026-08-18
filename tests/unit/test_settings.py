from figure_detection.settings import Settings


def test_project_directory_is_below_runtime(tmp_path) -> None:
    settings = Settings(runtime_dir=tmp_path)
    assert settings.projects_dir == tmp_path / "projects"
