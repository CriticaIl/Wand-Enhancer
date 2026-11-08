import SafariServices
import os.log

/// Native side of the Safari Web Extension. SaveForge does all its work in
/// JavaScript, so this only answers (echoes) native messages, as Apple's
/// template does. No data is stored or sent anywhere.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 17.0, macOS 14.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }
        os_log(.default, "SaveForge received a native message: %@", String(describing: message))

        let response = NSExtensionItem()
        if #available(iOS 17.0, macOS 14.0, *) {
            response.userInfo = [SFExtensionMessageKey: ["echo": message as Any]]
        } else {
            response.userInfo = ["message": ["echo": message as Any]]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
