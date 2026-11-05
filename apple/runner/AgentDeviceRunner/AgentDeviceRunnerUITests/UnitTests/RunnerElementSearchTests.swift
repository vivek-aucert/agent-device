import AgentDeviceSnapshotPresentation
import XCTest

#if AGENT_DEVICE_RUNNER_UNIT_TESTS && os(iOS)
/// Reads around element search that must keep their pre-search behavior on a lit-panel request.
extension RunnerTests {
  /// A lit-panel window walk that records an issue does not reach keyboard reads: they stay
  /// application-wide and fail open, so `keyboard dismiss` still answers.
  @MainActor
  func testKeyboardDismissIgnoresAFailedLitPanelWindowWalk() throws {
    let (panel, _) = launchAppOnTheLitPanel()
    defer { tearDownLitPanelApp() }
    litPanelWindowWalkIssueForTesting = true
    let command = try runnerCommandFixture(#"{"command":"keyboardDismiss",\#(panel)}"#)
    setRequestLitPanel(from: command)
    let response = try executeOnMainPrepared(command: command, activeApp: app)
    XCTAssertTrue(response.ok, String(describing: response.error))
  }

  /// A frame sample resolves the lit panel without booking it, so it never replaces the request's booking.
  @MainActor
  func testFrameSamplingResolvesTheLitPanelWithoutBookingIt() throws {
    let (panel, _) = launchAppOnTheLitPanel()
    defer { tearDownLitPanelApp() }
    setRequestLitPanel(from: try runnerCommandFixture(#"{"command":"snapshot",\#(panel)}"#))
    XCTAssertNotNil(captureRunnerFrame(app: app))
    XCTAssertNil(litPanelState.surface)
  }

  /// Every geometry, including an alert host's, carries the request's lit-panel size.
  @MainActor
  func testSurfaceGeometryCarriesTheRequestPanelSize() throws {
    let (panel, frame) = launchAppOnTheLitPanel()
    defer { tearDownLitPanelApp() }
    setRequestLitPanel(from: try runnerCommandFixture(#"{"command":"tap",\#(panel)}"#))
    XCTAssertEqual(surfaceGeometry(windowFrame: frame, app: app).panelNativeSize, frame.size)
  }
}
#endif
