export const validateCompanyRegistration = (req, res, next) => {
    const { company_name, company_email, password, country } = req.body;
    console.log({ ...req.body });
    const errors = {};
    // Validate company name
    if (!company_name?.trim()) {
        errors.company_name = "Company name is required";
    }
    else if (company_name.length > 100) {
        errors.company_name = "Company name must be less than 100 characters";
    }
    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!company_email?.trim()) {
        errors.company_email = "Company email is required";
    }
    else if (!emailRegex.test(company_email)) {
        errors.company_email = "Invalid email format";
    }
    // Validate password
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!password?.trim()) {
        errors.password = "Password is required";
    }
    else if (!passwordRegex.test(password)) {
        errors.password =
            "Password must contain at least 8 characters, one uppercase, one lowercase, one number and one special character";
    }
    // Validate country
    if (!country?.trim()) {
        errors.country = "Country is required";
    }
    if (Object.keys(errors).length > 0) {
        res.status(400).json({
            success: false,
            errors,
        });
        return;
    }
    next();
};
