function verifyFormDestination() {
  // Define the IDs based on your URLs
  const formId = '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI';
  const expectedNewSheetId = '1RWPNUjVeRRcHiI18b8_IzLn1RzKHG3hLJvIbZjWq6Bc';
  const oldSheetId = '1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGl998ChVVMypyCk';

  try {
    // Open the Form
    const form = FormApp.openById(formId);
    
    // Get the destination ID where responses are currently being sent
    const currentDestinationId = form.getDestinationId();
    
    Logger.log("=== Form Link Verification ===");
    Logger.log("Form Title: " + form.getTitle());
    
    // Check if the form has a destination at all
    if (!currentDestinationId) {
      Logger.log("❌ ERROR: The form is not linked to any destination sheet.");
      return;
    }
    
    Logger.log("Actual Linked Sheet ID: " + currentDestinationId);
    
    // Evaluate the destination
    if (currentDestinationId === expectedNewSheetId) {
      Logger.log("✅ SUCCESS: The form is correctly linked to your NEW Response Sheet.");
    } else if (currentDestinationId === oldSheetId) {
      Logger.log("❌ FAILURE: The form is still linking to the OLD Response Sheet.");
    } else {
      Logger.log("⚠️ WARNING: The form is linked to an unknown Sheet ID (neither the old nor the new expected ID).");
    }
    
  } catch (error) {
    Logger.log("❌ EXECUTION ERROR: Could not access the form. Ensure you have edit access and the ID is correct. Details: " + error.message);
  }
}